/**
 * Remove R2 objects under job-imports/ that are no longer referenced in the database.
 * Usage: node scripts/cleanup-job-import-r2-orphans.mjs
 */
import 'dotenv/config';
import postgres from 'postgres';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const JOB_IMPORT_PREFIX = 'job-imports/';

function getR2Client() {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('R2 is not configured. Set CLOUDFLARE_R2_* environment variables.');
  }

  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    }),
    bucketName,
  };
}

async function listR2Keys(client, bucket, prefix) {
  const keys = [];
  let continuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents || []) {
      if (item.Key) keys.push(item.Key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function loadReferencedKeys(sql) {
  const draftRows = await sql`SELECT r2_key FROM job_import_draft_attachments`;
  const noteRows = await sql`
    SELECT r2_key
    FROM job_note_attachments
    WHERE r2_key LIKE ${`${JOB_IMPORT_PREFIX}%`}
  `;

  const referenced = new Set();
  for (const row of [...draftRows, ...noteRows]) {
    if (row.r2_key) referenced.add(row.r2_key);
  }
  return referenced;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  const { client, bucketName } = getR2Client();
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const referencedKeys = await loadReferencedKeys(sql);
    const r2Keys = await listR2Keys(client, bucketName, JOB_IMPORT_PREFIX);
    const orphanKeys = r2Keys.filter((key) => !referencedKeys.has(key));

    console.log(
      `Found ${r2Keys.length} R2 object(s) under ${JOB_IMPORT_PREFIX}, ${referencedKeys.size} referenced in DB.`,
    );

    if (orphanKeys.length === 0) {
      console.log('No orphaned job-import R2 objects found.');
      return;
    }

    console.log(`Deleting ${orphanKeys.length} orphaned job-import R2 object(s)...`);

    for (const key of orphanKeys) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      console.log(`Deleted: ${key}`);
    }

    console.log('Done.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
