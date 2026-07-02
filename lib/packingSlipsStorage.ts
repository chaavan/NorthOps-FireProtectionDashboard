import { createPresignedGetUrl, createPresignedPutUrl, deleteR2Object, getPackingSlipsBucketName } from './r2';
import { randomUUID } from 'crypto';

export type PackingSlipObject = {
  key: string;
  url: string;
};

export function buildPackingSlipKey(params: {
  jobNumber: string;
  listNumber: string;
  originalFileName: string;
}): string {
  const { jobNumber, listNumber, originalFileName } = params;
  const safeJob = jobNumber.trim();
  const safeList = (listNumber || '1').toString().trim() || '1';
  const uuid = randomUUID();
  const basename = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `jobs/${safeJob}/${safeList}/packing-slips/${uuid}-${basename}`;
}

export async function getPackingSlipDownloadUrl(key: string): Promise<string> {
  return await createPresignedGetUrl({
    key,
    bucketNameOverride: getPackingSlipsBucketName(),
  });
}

export async function getPackingSlipUploadUrl(params: {
  key: string;
  contentType: string;
  contentLength?: number;
}): Promise<string> {
  const { key, contentType, contentLength } = params;
  return await createPresignedPutUrl({
    key,
    contentType,
    contentLength,
    bucketNameOverride: getPackingSlipsBucketName(),
  });
}

export async function deletePackingSlipObject(key: string): Promise<void> {
  await deleteR2Object({
    key,
    bucketNameOverride: getPackingSlipsBucketName(),
  });
}

