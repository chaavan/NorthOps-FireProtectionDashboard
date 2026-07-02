/**
 * Pure helpers for adaptive page-based chunking of job-import OCR (no OpenAI / DB).
 */

export function buildOrderedMaterialPages(
  allPageNumbersSorted: number[],
  materialPageNumbers: number[],
): number[] {
  const filtered = materialPageNumbers.filter((n) => Number.isFinite(n) && n > 0);
  if (filtered.length > 0) {
    const set = new Set(filtered);
    return allPageNumbersSorted.filter((n) => set.has(n));
  }
  return [...allPageNumbersSorted];
}

/**
 * Greedy pack ordered page numbers into chunks so measuredChars(trial) stays <= maxInputChars.
 * Does not add overlap (caller uses addOnePageOverlapBetweenChunks).
 */
export function buildGreedyPageChunks(
  orderedPageNumbers: number[],
  maxInputChars: number,
  measureChars: (pageNums: number[]) => number,
): number[][] {
  if (orderedPageNumbers.length === 0) return [];
  const chunks: number[][] = [];
  let start = 0;
  while (start < orderedPageNumbers.length) {
    const chunk: number[] = [];
    let end = start;
    while (end < orderedPageNumbers.length) {
      const next = orderedPageNumbers[end];
      const trial = [...chunk, next];
      const size = measureChars(trial);
      if (size > maxInputChars && chunk.length > 0) break;
      chunk.push(next);
      end += 1;
      if (size > maxInputChars && chunk.length === 1) break;
    }
    if (chunk.length === 0) {
      chunk.push(orderedPageNumbers[start]);
      start += 1;
    } else {
      start = end;
    }
    chunks.push(chunk);
  }
  return chunks;
}

/** Prepend each chunk after the first with the last page of the previous chunk if missing. */
export function addOnePageOverlapBetweenChunks(chunks: number[][]): number[][] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const prev = chunks[index - 1];
    const bridge = prev[prev.length - 1];
    if (chunk[0] === bridge) return chunk;
    return [bridge, ...chunk];
  });
}

export function chunkPageRangeLabel(pageNums: number[]): [number, number] {
  if (pageNums.length === 0) return [0, 0];
  const sorted = [...pageNums].sort((a, b) => a - b);
  return [sorted[0], sorted[sorted.length - 1]];
}

export async function runBoundedPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const runWorker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export type RawLineItemLike = {
  partNumber?: string | null;
  quantityNeeded?: number | null;
  quantityFab?: number | null;
  quantityLoose?: number | null;
  description?: string | null;
};

function normPart(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function normDesc(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

/** Drop adjacent duplicates likely from overlapping chunk boundaries. */
export function dedupeAdjacentRawLineItems<T extends RawLineItemLike>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (
      prev &&
      normPart(prev.partNumber) === normPart(item.partNumber) &&
      Number(prev.quantityNeeded || 0) === Number(item.quantityNeeded || 0) &&
      Number(prev.quantityFab || 0) === Number(item.quantityFab || 0) &&
      Number(prev.quantityLoose || 0) === Number(item.quantityLoose || 0) &&
      normDesc(prev.description) === normDesc(item.description)
    ) {
      continue;
    }
    out.push(item);
  }
  return out;
}
