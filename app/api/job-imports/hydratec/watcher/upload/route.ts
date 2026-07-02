import { NextRequest, NextResponse } from 'next/server';
import { verifyWatcherKey, touchWatcherKeyLastSeen } from '@/lib/hydraTecWatcherAuth';
import { createJobImportDraft, parseJobImport, getJobImport, findDuplicateHydraTecDraft } from '@/lib/jobImportService';
import { parseHydraTecExport } from '@/lib/jobImportHydraTecParser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const watcherKey = await verifyWatcherKey(request.headers.get('authorization'));
  if (!watcherKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await touchWatcherKeyLastSeen(watcherKey.id);

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A .hvuf file is required.' }, { status: 400 });
  }
  if (!/\.hvuf$/i.test(file.name)) {
    return NextResponse.json({ error: 'Only .hvuf files are accepted on this endpoint.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Skip creating a duplicate draft if this is the same job/list/generation
  // (Stocklist Date) as one already parsed - HydraLIST export folders can
  // end up with more than one copy of literally the same pick sheet.
  try {
    const { jobInfo } = parseHydraTecExport(buffer);
    const duplicate = await findDuplicateHydraTecDraft({
      jobNumber: jobInfo.jobNumber ?? null,
      listNumber: jobInfo.listNumber ?? null,
      stocklistDate: jobInfo.stocklistDeliveryShipDate ?? null,
    });
    if (duplicate) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'duplicate',
        message: `Already have a draft for job ${jobInfo.jobNumber} list ${jobInfo.listNumber} dated ${jobInfo.stocklistDeliveryShipDate} (import ${duplicate.id}).`,
      });
    }
  } catch {
    // If the file can't even be unpacked/parsed, fall through and let the
    // normal createJobImportDraft/parseJobImport flow surface the error in
    // the usual FAILED-draft way, rather than failing the upload silently.
  }

  const draft = await createJobImportDraft({
    fileName: file.name,
    contentType: 'application/x-hvuf',
    fileBytes: buffer,
    createdBy: `watcher:${watcherKey.name}`,
    sourceFormat: 'hvuf',
  });

  await parseJobImport(draft.id);
  const response = await getJobImport(draft.id);

  return NextResponse.json({ success: response.status === 'READY', import: response });
}
