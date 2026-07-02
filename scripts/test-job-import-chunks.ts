/**
 * Quick sanity checks for adaptive chunking helpers (run: npx tsx scripts/test-job-import-chunks.ts).
 */
import {
  addOnePageOverlapBetweenChunks,
  buildGreedyPageChunks,
  buildOrderedMaterialPages,
  dedupeAdjacentRawLineItems,
  runBoundedPool,
} from '../lib/jobImportChunkedParse';

function assert(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const fakeMeasure =
  (weights: Record<number, number>) =>
  (pageNums: number[]) =>
    pageNums.reduce((sum, p) => sum + (weights[p] ?? 1000), 0);

const weights: Record<number, number> = { 1: 20000, 2: 20000, 3: 20000, 4: 5000, 5: 5000 };
const ordered = [1, 2, 3, 4, 5];
const greedy = buildGreedyPageChunks(ordered, 48000, fakeMeasure(weights));
assert('greedy produces multiple chunks when over budget', greedy.length >= 2);

const overlapped = addOnePageOverlapBetweenChunks(greedy);
assert('overlap preserves first chunk', overlapped[0].join(',') === greedy[0].join(','));
if (overlapped.length > 1) {
  assert('overlap bridges adjacent chunks', overlapped[1][0] === greedy[0][greedy[0].length - 1]);
}

const material = buildOrderedMaterialPages([1, 2, 3, 4, 5], [5, 2]);
assert('material order follows document order', material.join(',') === '2,5');

const rawDupes = [
  { partNumber: 'ABC12', quantityNeeded: 1, quantityFab: 0, quantityLoose: 1, description: 'x' },
  { partNumber: 'ABC12', quantityNeeded: 1, quantityFab: 0, quantityLoose: 1, description: 'x' },
  { partNumber: 'DEF99', quantityNeeded: 2, quantityFab: 0, quantityLoose: 2, description: 'y' },
];
const deduped = dedupeAdjacentRawLineItems(rawDupes);
assert('dedupe drops identical adjacent rows', deduped.length === 2);

async function main() {
  const order = await runBoundedPool([1, 2, 3, 4], 2, async (n) => n * 2);
  assert('bounded pool preserves order', order.join(',') === '2,4,6,8');
  console.log('All chunk helper checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
