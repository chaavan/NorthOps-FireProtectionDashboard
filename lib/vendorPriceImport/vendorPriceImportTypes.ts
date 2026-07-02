import type { VendorPriceImportLineMatchStatus, VendorPriceImportStatus } from '@prisma/client';

export const VENDOR_PRICE_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const VENDOR_PRICE_ALLOWED_EXTENSIONS = ['xlsx', 'xls', 'csv'] as const;

export type ParsedVendorPriceRow = {
  rowIndex: number;
  vendorPartIdRaw: string;
  vendorPartIdNormalized: string;
  descriptionFromFile: string | null;
  uomFromFile: string | null;
  proposedCost: number;
};

export type VendorPriceImportSummary = {
  /** Total rows read from the vendor file */
  fileRowCount: number;
  /** Rows stored after parse (includes collapsed duplicates) */
  parsedRows: number;
  /** Duplicate file rows merged (same vendor ID, price, and description) */
  collapsedDuplicateCount: number;
  matchedCount: number;
  selectedCount: number;
  /** Selected matched rows where costAfter differs from vendor file proposedCost */
  manuallyAdjustedCount: number;
  conflictInFileCount: number;
  unmatchedCount: number;
  noCostChangeCount: number;
  ambiguousCount: number;
  increasesCount: number;
  decreasesCount: number;
  avgPercentChangeSelected: number | null;
  unresolvedConflictGroups: number;
};

export type VendorPriceReviewLine = {
  id: string;
  rowIndex: number;
  vendorPartIdNormalized: string;
  vendorPartIdRaw: string | null;
  descriptionFromFile: string | null;
  uomFromFile: string | null;
  proposedCost: number;
  matchStatus: VendorPriceImportLineMatchStatus;
  partId: string | null;
  pn: string | null;
  nomenclature: string | null;
  costBefore: number | null;
  costAfter: number | null;
  percentChange: number | null;
  conflictGroupId: string | null;
  selected: boolean;
  /** True when costAfter differs from the vendor file price (proposedCost). */
  isManuallyAdjusted: boolean;
};

export type VendorPriceConflictCandidate = {
  id: string;
  pn: string;
  nomenclature: string;
  cost: number;
};

export type VendorPriceConflictGroup = {
  conflictGroupId: string;
  vendorPartIdNormalized: string;
  rows: VendorPriceReviewLine[];
  candidateParts?: VendorPriceConflictCandidate[];
};

export type VendorPriceReviewSnapshot = {
  importId: string;
  vendorKey: string;
  vendorDisplayName: string;
  sourceFileName: string;
  status: VendorPriceImportStatus;
  summary: VendorPriceImportSummary;
  lines: VendorPriceReviewLine[];
  conflicts: VendorPriceConflictGroup[];
  blockingIssues: string[];
};

export type VendorPriceImportListItem = {
  id: string;
  status: VendorPriceImportStatus;
  vendorKey: string;
  vendorDisplayName: string;
  sourceFileName: string;
  sourceType: string;
  summary: VendorPriceImportSummary | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  errorMessage: string | null;
};

export type ResolveConflictInput = {
  conflictGroupId: string;
  winningLineId: string;
  /** Required when resolving MATCHED_AMBIGUOUS groups with multiple inventory parts */
  partId?: string;
};

export type UpdateReviewInput = {
  lineSelections?: Array<{ lineId: string; selected: boolean }>;
  /** Matched rows to skip — excluded from review and commit */
  excludeLineIds?: string[];
  /** Override costAfter for matched rows (manual unit price edits). */
  lineCostOverrides?: Array<{ lineId: string; costAfter: number }>;
  /** Restore costAfter to vendor file proposedCost. */
  resetLineCostIds?: string[];
  resolveConflicts?: ResolveConflictInput[];
};
