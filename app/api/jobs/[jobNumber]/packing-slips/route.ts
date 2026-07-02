import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import { requireJobScopedPermission } from '@/lib/jobScopedAccess';
import { buildPackingSlipKey, deletePackingSlipObject, getPackingSlipDownloadUrl, getPackingSlipUploadUrl } from '@/lib/packingSlipsStorage';
import { isR2Configured } from '@/lib/r2';

export const dynamic = 'force-dynamic';

async function ensurePackingSlipsTableExists(): Promise<void> {
  // Mirrors prisma/migrations/20260318000000_add_packing_slips_table/migration.sql
  // and is safe to run repeatedly.
  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "packing_slips" (
  "id"           text PRIMARY KEY,
  "job_number"   text NOT NULL,
  "list_number"  text NOT NULL DEFAULT '1',
  "file_name"    text NOT NULL,
  "storage_key"  text NOT NULL,
  "content_type" text,
  "size"         integer,
  "uploaded_by"  text NOT NULL,
  "uploaded_at"  timestamptz NOT NULL DEFAULT now()
);
  `);

  await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "packing_slips_job_number_list_number_idx"
  ON "packing_slips"("job_number", "list_number");
  `);
}

function isPrismaTableMissingError(error: unknown): boolean {
  return (error as any)?.code === 'P2021';
}

function isR2ConfigurationError(error: unknown): boolean {
  const msg = (error as any)?.message;
  return typeof msg === 'string' && msg.startsWith('Missing CLOUDFLARE_R2_');
}

// GET /api/jobs/[jobNumber]/packing-slips?listNumber=123
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber } = await params;
    const searchParams = request.nextUrl.searchParams;
    const listNumberRaw = searchParams.get('listNumber');
    const listNumberContext = normalizeListContextForLookup(listNumberRaw);

    const access = await requireJobScopedPermission(
      session,
      'job.notes.view',
      jobNumber.trim(),
      listNumberRaw,
    );
    if (!access.ok) return access.response;

    const attachments = await prisma.packingSlipAttachment.findMany({
      where: {
        jobNumber: jobNumber.trim(),
        listNumber: listNumberContext,
      },
      orderBy: { uploadedAt: 'desc' },
    });

    const items = await Promise.all(
      attachments.map(async (att) => {
        const url = await getPackingSlipDownloadUrl(att.storageKey);
        return {
          id: att.id,
          jobNumber: att.jobNumber,
          listNumber: att.listNumber,
          fileName: att.fileName,
          contentType: att.contentType,
          size: att.size,
          uploadedBy: att.uploadedBy,
          uploadedAt: att.uploadedAt,
          url,
        };
      }),
    );

    return NextResponse.json({ attachments: items });
  } catch (error) {
    // P2021 = table doesn't exist yet (migration not yet run). Self-heal and retry once.
    if (isPrismaTableMissingError(error)) {
      try {
        await ensurePackingSlipsTableExists();
        return NextResponse.json({ attachments: [] });
      } catch (e) {
        console.error('Failed to self-heal packing_slips table:', e);
        return NextResponse.json(
          { error: 'Packing slips database is not ready. Please contact support.' },
          { status: 503 },
        );
      }
    }
    if (isR2ConfigurationError(error)) {
      return NextResponse.json(
        {
          error:
            'Packing slips storage (R2) is not configured. Please contact support.',
        },
        { status: 503 },
      );
    }
    console.error('Error in /api/jobs/[jobNumber]/packing-slips GET:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/jobs/[jobNumber]/packing-slips?listNumber=123
// Accepts multipart/form-data with one or more files. Does NOT send any notifications.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'Packing slips storage (R2) is not configured. Please contact support.' },
        { status: 503 },
      );
    }

    const { jobNumber } = await params;
    const userEmail = (session.user as any).email as string;

    const searchParams = request.nextUrl.searchParams;
    const listNumberRaw = searchParams.get('listNumber');
    const listNumberContext = normalizeListContextForLookup(listNumberRaw);

    const access = await requireJobScopedPermission(
      session,
      'job.notes.upload_packing_slips',
      jobNumber.trim(),
      listNumberRaw,
    );
    if (!access.ok) return access.response;

    const formData = await request.formData();
    const files = formData.getAll('files').filter((v): v is File => v instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const maxSizeBytes = 20 * 1024 * 1024; // 20MB per file
    const created: Array<{ id: string; fileName: string }> = [];

    for (const file of files) {
      if (file.size > maxSizeBytes) {
        return NextResponse.json(
          { error: `File "${file.name}" is too large. Max size is 20MB.` },
          { status: 400 },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const key = buildPackingSlipKey({
        jobNumber,
        listNumber: listNumberContext,
        originalFileName: file.name,
      });

      // Upload directly to R2 via presigned PUT
      const putUrl = await getPackingSlipUploadUrl({
        key,
        contentType: file.type || 'application/octet-stream',
        contentLength: buffer.length,
      });

      const putResp = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: buffer,
      });
      if (!putResp.ok) {
        console.error('Failed to upload packing slip to R2', await putResp.text());
        return NextResponse.json(
          { error: `Failed to upload "${file.name}" to storage` },
          { status: 500 },
        );
      }

      const record = await prisma.packingSlipAttachment.create({
        data: {
          jobNumber: jobNumber.trim(),
          listNumber: listNumberContext,
          fileName: file.name,
          storageKey: key,
          contentType: file.type || null,
          size: buffer.length,
          uploadedBy: userEmail,
        },
      });

      created.push({ id: record.id, fileName: record.fileName });
    }

    return NextResponse.json({ success: true, created });
  } catch (error) {
    if (isPrismaTableMissingError(error)) {
      try {
        await ensurePackingSlipsTableExists();
        return NextResponse.json(
          { error: 'Packing slips storage was just initialized. Please retry the upload.' },
          { status: 503 },
        );
      } catch (e) {
        console.error('Failed to self-heal packing_slips table:', e);
        return NextResponse.json(
          { error: 'Packing slips are not yet available for this job. Please contact support.' },
          { status: 503 },
        );
      }
    }
    if (isR2ConfigurationError(error)) {
      return NextResponse.json(
        {
          error:
            'Packing slips storage (R2) is not configured. Please contact support.',
        },
        { status: 503 },
      );
    }
    console.error('Error in /api/jobs/[jobNumber]/packing-slips POST:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// DELETE /api/jobs/[jobNumber]/packing-slips?id=...
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber } = await params;

    const searchParams = request.nextUrl.searchParams;
    const listNumberRaw = searchParams.get('listNumber');
    const listNumberContext = normalizeListContextForLookup(listNumberRaw);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const access = await requireJobScopedPermission(
      session,
      'job.notes.upload_packing_slips',
      jobNumber.trim(),
      listNumberRaw,
    );
    if (!access.ok) return access.response;

    const attachment = await prisma.packingSlipAttachment.findFirst({
      where: {
        id,
        jobNumber: jobNumber.trim(),
        listNumber: listNumberContext,
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    await deletePackingSlipObject(attachment.storageKey);
    await prisma.packingSlipAttachment.delete({ where: { id: attachment.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isPrismaTableMissingError(error)) {
      try {
        await ensurePackingSlipsTableExists();
        return NextResponse.json(
          { error: 'Packing slips storage was just initialized. Please retry.' },
          { status: 503 },
        );
      } catch (e) {
        console.error('Failed to self-heal packing_slips table:', e);
        return NextResponse.json({ error: 'Packing slips table not found.' }, { status: 503 });
      }
    }
    if (isR2ConfigurationError(error)) {
      return NextResponse.json(
        {
          error:
            'Packing slips storage (R2) is not configured. Please contact support.',
        },
        { status: 503 },
      );
    }
    console.error('Error in /api/jobs/[jobNumber]/packing-slips DELETE:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

