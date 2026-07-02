import assert from 'assert';
import { parseJsonObjectFromLlm } from '../lib/jobImportJsonParse';

const valid = parseJsonObjectFromLlm<{ jobInfo: { jobName: string } }>(
  '{"jobInfo":{"jobName":"Simple Job"}}',
);
assert.equal(valid.jobInfo.jobName, 'Simple Job');

const withLiteralNewline = parseJsonObjectFromLlm<{ jobInfo: { jobName: string } }>(
  '{"jobInfo":{"jobName":"Line 1\nLine 2"}}',
);
assert.equal(withLiteralNewline.jobInfo.jobName, 'Line 1\nLine 2');

const withFence = parseJsonObjectFromLlm<{ lineItems: unknown[] }>(
  '```json\n{"lineItems":[]}\n```',
);
assert.deepEqual(withFence.lineItems, []);

console.log('jobImportJsonParse checks passed.');
