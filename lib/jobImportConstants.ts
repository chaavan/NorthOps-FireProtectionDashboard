/**
 * Placeholder part number for jobs/lists with no real line items yet.
 * Must match DB usage in createJobWithMerge / job rows.
 */
export const NO_PARTS_PLACEHOLDER_PART_NUMBER = '__NO_PARTS__';

export type JobImportIntent = 'full' | 'header_stub';

export function normalizeJobImportIntent(raw: unknown): JobImportIntent {
  return raw === 'header_stub' ? 'header_stub' : 'full';
}

/** True when the PDF matches TF picksheet layout but the deterministic table parser found no part rows (header-only / empty table). */
export function shouldUseHeaderStubImportPath(
  layoutProfile: 'tf_material_picksheet_v1' | 'unknown',
  deterministicLineItemCount: number,
): boolean {
  return layoutProfile === 'tf_material_picksheet_v1' && deterministicLineItemCount === 0;
}
