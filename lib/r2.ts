import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  signedUrlTtlSeconds: number;
};

export function isR2Configured(): boolean {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  return !!(
    accountId &&
    accountId.trim() &&
    accessKeyId &&
    accessKeyId.trim() &&
    secretAccessKey &&
    secretAccessKey.trim() &&
    bucketName &&
    bucketName.trim()
  );
}

function getR2Env(): R2Env {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

  const ttlRaw = process.env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS;
  const signedUrlTtlSeconds = ttlRaw ? Number(ttlRaw) : 600;

  if (!accountId) throw new Error('Missing CLOUDFLARE_R2_ACCOUNT_ID');
  if (!accessKeyId) throw new Error('Missing CLOUDFLARE_R2_ACCESS_KEY_ID');
  if (!secretAccessKey) throw new Error('Missing CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  if (!bucketName) throw new Error('Missing CLOUDFLARE_R2_BUCKET_NAME');
  if (!Number.isFinite(signedUrlTtlSeconds) || signedUrlTtlSeconds <= 0) {
    throw new Error('Invalid CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS (must be a positive number)');
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, signedUrlTtlSeconds };
}

let _r2Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (_r2Client) return _r2Client;
  const { accountId, accessKeyId, secretAccessKey } = getR2Env();

  _r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  return _r2Client;
}

export function getR2BucketName(): string {
  return getR2Env().bucketName;
}

export function getPackingSlipsBucketName(): string {
  const override = process.env.CLOUDFLARE_R2_PACKING_SLIPS_BUCKET_NAME;
  return override && override.trim().length > 0 ? override.trim() : getR2BucketName();
}

export function getR2SignedUrlTtlSeconds(): number {
  return getR2Env().signedUrlTtlSeconds;
}

export async function putR2Object(params: {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  bucketNameOverride?: string;
}): Promise<void> {
  const { key, body, contentType, bucketNameOverride } = params;
  const bucket =
    bucketNameOverride && bucketNameOverride.trim().length > 0
      ? bucketNameOverride.trim()
      : getR2BucketName();

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function createPresignedPutUrl(params: {
  key: string;
  contentType: string;
  cacheControl?: string;
  expiresInSeconds?: number;
  contentLength?: number;
  bucketNameOverride?: string;
}): Promise<string> {
  const { key, contentType, cacheControl, expiresInSeconds, contentLength, bucketNameOverride } =
    params;
  const bucket = bucketNameOverride && bucketNameOverride.trim().length > 0
    ? bucketNameOverride.trim()
    : getR2BucketName();
  const ttl = expiresInSeconds ?? getR2SignedUrlTtlSeconds();

  const input: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  };

  // Optional headers that may be included in the signature. Only set if you also
  // send them during the PUT upload from the browser.
  if (cacheControl) input.CacheControl = cacheControl;
  if (typeof contentLength === 'number' && Number.isFinite(contentLength)) {
    input.ContentLength = contentLength;
  }

  const cmd = new PutObjectCommand(input);
  return await getSignedUrl(getR2Client(), cmd, { expiresIn: ttl });
}

export async function createPresignedGetUrl(params: {
  key: string;
  expiresInSeconds?: number;
  bucketNameOverride?: string;
}): Promise<string> {
  const { key, expiresInSeconds, bucketNameOverride } = params;
  const bucket = bucketNameOverride && bucketNameOverride.trim().length > 0
    ? bucketNameOverride.trim()
    : getR2BucketName();
  const ttl = expiresInSeconds ?? getR2SignedUrlTtlSeconds();

  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(getR2Client(), cmd, { expiresIn: ttl });
}

export async function deleteR2Object(params: { key: string; bucketNameOverride?: string }): Promise<void> {
  const { key, bucketNameOverride } = params;
  const bucket = bucketNameOverride && bucketNameOverride.trim().length > 0
    ? bucketNameOverride.trim()
    : getR2BucketName();

  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

