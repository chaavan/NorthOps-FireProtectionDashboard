import type { JobImportIntent } from './jobImportConstants';

export type ImportSourceKind =
  | 'printed'
  | 'handwritten'
  | 'ai-derived'
  | 'user-edited';

export type JobImportMode = 'new_job_import' | 'existing_job_update';

export type ImportWarningSeverity = 'info' | 'warning' | 'error';

export type ImportDuplicateAction = 'add' | 'replace' | 'skip' | 'custom';

export type JobImportLayoutProfile = 'tf_material_picksheet_v1' | 'unknown';

export type ImportLineReviewStatus = 'trusted' | 'needs_review' | 'user_confirmed';

export type ImportLineResolutionSource = 'ocr' | 'vision' | 'merged' | 'fallback' | 'user';

export interface ImportEvidenceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImportLineItemCandidate {
  source: 'primary' | 'secondary' | 'catalog' | 'user';
  partNumber: string;
  quantityNeeded: number;
  quantityFab: number;
  quantityLoose: number;
  description: string | null;
  unitOfMeasurement: string | null;
  confidenceScore: number | null;
  note?: string | null;
}

export interface ImportCatalogMatch {
  found: boolean;
  description: string | null;
  unitOfMeasurement: string | null;
  descriptionMatches: boolean | null;
  unitMatches: boolean | null;
}

export interface ImportLineItemEvidence {
  page: number | null;
  bbox: ImportEvidenceBoundingBox | null;
  ocrText: string | null;
  primaryCandidate: ImportLineItemCandidate | null;
  secondaryCandidate: ImportLineItemCandidate | null;
  catalogMatch: ImportCatalogMatch | null;
}

export interface ImportComparisonSummary {
  primaryRowCount: number;
  secondaryRowCount: number;
  agreedRowCount: number;
  disagreedRowCount: number;
  riskyRowCount: number;
}

export interface ImportVisionMetadata {
  renderedPages: number[];
  imageCount: number;
  dpi: number;
  imageWidth: number | null;
  imageHeight: number | null;
  model: string | null;
}

export interface ImportArbitrationSummary {
  usedPrimaryRows: number;
  usedVisionRows: number;
  mergedRows: number;
  fallbackRows: number;
  warningCount: number;
}

export interface ImportCorrectionSignal {
  importId: string;
  sourceFileName: string;
  sourceFileHash: string | null;
  layoutProfile: JobImportLayoutProfile;
  lineItemId: string;
  originalReviewStatus: ImportLineReviewStatus;
  originalItem: {
    partNumber: string;
    quantityNeeded: number;
    quantityFab: number;
    quantityLoose: number;
    description: string | null;
    unitOfMeasurement: string | null;
  };
  finalItem: {
    partNumber: string;
    quantityNeeded: number;
    quantityFab: number;
    quantityLoose: number;
    description: string | null;
    unitOfMeasurement: string | null;
  };
  validationFlags: string[];
}

export interface ImportWarning {
  code: string;
  severity: ImportWarningSeverity;
  message: string;
  field?: string | null;
  lineItemId?: string | null;
}

export interface ImportFieldCandidate {
  value: string | null;
  sourceKind: ImportSourceKind;
  confidence?: number | null;
  note?: string | null;
  selected?: boolean;
}

export interface ImportParsedJobInfo {
  jobNumber: string;
  jobName: string;
  listNumber: string;
  area: string;
  locationShipTo: string;
  stocklistDeliveryShipDate: string;
  listedBy: string;
  deliveryDate: string;
}

export interface ImportParsedLineItem {
  id: string;
  partNumber: string;
  quantityNeeded: number;
  quantityFab: number;
  quantityLoose: number;
  description: string | null;
  unitOfMeasurement: string | null;
  type: string | null;
  sourceNeeded?: number | null;
  sourceFab?: number | null;
  sourceLoose?: number | null;
  uomFromPdf?: string | null;
  warnings: string[];
  unknownPart: boolean;
  reviewStatus: ImportLineReviewStatus;
  resolutionSource?: ImportLineResolutionSource | null;
  confidenceScore: number | null;
  validationFlags: string[];
  verificationWarnings?: string[];
  arbitrationNotes?: string[];
  evidence: ImportLineItemEvidence | null;
  rowOrder?: number | null;
  sectionName?: string | null;
  provenance?: {
    partNumber?: ImportSourceKind;
    quantityNeeded?: ImportSourceKind;
    quantityFab?: ImportSourceKind;
    description?: ImportSourceKind;
    unitOfMeasurement?: ImportSourceKind;
  };
}

export interface ImportDuplicatePart {
  partNumber: string;
  description: string | null;
  existingQuantityNeeded: number;
  existingQuantityFab: number;
  incomingQuantityNeeded: number;
  incomingQuantityFab: number;
}

export interface ImportDuplicateSnapshot {
  exists: boolean;
  jobNumber: string;
  jobName: string;
  listNumber: string;
  existingParts: Array<{
    partNumber: string;
    description: string | null;
    quantityNeeded: number;
    quantityFab: number;
  }>;
  duplicateParts: ImportDuplicatePart[];
  newPartsCount: number;
}

export interface ImportDuplicateDecision {
  partNumber: string;
  action: ImportDuplicateAction;
  customQuantity?: number | null;
}

export interface JobImportTargetContext {
  jobNumber: string | null;
  jobName: string | null;
  listNumber: string | null;
  availableListNumbers: string[];
  lockedIdentifiers: boolean;
  requiresListSelection: boolean;
  listSelectionConfirmed: boolean;
  launchedFromAllLists: boolean;
}

export interface JobImportIdentifierMismatch {
  field: 'jobNumber' | 'jobName' | 'listNumber';
  parsedValue: string | null;
  targetValue: string | null;
}

export interface JobImportReviewSnapshot {
  mode: JobImportMode;
  jobInfo: ImportParsedJobInfo;
  currentJobInfo: ImportParsedJobInfo | null;
  targetContext: JobImportTargetContext | null;
  identifierMismatches: JobImportIdentifierMismatch[];
  fieldCandidates: Partial<Record<keyof ImportParsedJobInfo, ImportFieldCandidate[]>>;
  lineItems: ImportParsedLineItem[];
  warnings: ImportWarning[];
  missingRequiredFields: Array<keyof ImportParsedJobInfo>;
  handwrittenNotes: string[];
  duplicateInfo: ImportDuplicateSnapshot | null;
  duplicateDecisions: ImportDuplicateDecision[];
  layoutProfile: JobImportLayoutProfile;
  formatTrusted: boolean;
  comparisonSummary: ImportComparisonSummary;
  arbitrationSummary?: ImportArbitrationSummary | null;
  visionMetadata?: ImportVisionMetadata | null;
  blockingIssues: ImportWarning[];
  trustedRowCount: number;
  needsReviewRowCount: number;
  sourceFileHash: string | null;
  /** User-entered note in the import workspace; saved as a job note on commit (with notification). */
  workspaceNote?: string | null;
  correctionSignals: ImportCorrectionSignal[];
  parserModel: string;
  parserVersion: string;
  ocrCharacterCount: number;
  importedAt: string;
  sourceFileName: string;
}

export interface JobImportDraftAccessGrant {
  userEmail: string;
}

export interface JobImportDraftAttachment {
  id: string;
  fileName: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedByEmail: string | null;
  url?: string | null;
}

export interface JobImportDraftState {
  accessGrants: JobImportDraftAccessGrant[];
  lastAutosavedAt: string | null;
  draftVersion?: number;
}

export interface JobImportRecordResponse {
  id: string;
  mode: JobImportMode;
  /** Set when parse completes: header_stub = TF picksheet detected but no material rows (fast path). */
  importIntent: JobImportIntent;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'COMMITTED';
  sourceFileName: string;
  sourceContentType: string | null;
  sourceFileSize: number;
  sourceDownloadPath: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  committedJobNumber: string | null;
  committedListNumber: string | null;
  targetJobNumber: string | null;
  targetListNumber: string | null;
  targetJobName: string | null;
  errorMessage: string | null;
  rawTextPreview: string | null;
  ocrMetadata: Record<string, unknown> | null;
  warningSummary: Record<string, number> | null;
  reviewSnapshot: JobImportReviewSnapshot | null;
  draftState: JobImportDraftState;
}

export interface JobImportListSummary {
  id: string;
  status: JobImportRecordResponse['status'];
  sourceFileName: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  draftState: JobImportDraftState;
  jobInfo: Pick<ImportParsedJobInfo, 'jobNumber' | 'jobName' | 'listNumber'> | null;
}

export type JobImportListStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface JobImportListStatusCounts {
  all: number;
  processing: number;
  ready: number;
  failed: number;
}

export interface JobImportListPage {
  imports: JobImportListSummary[];
  counts: JobImportListStatusCounts;
  nextCursor: string | null;
  hasMore: boolean;
}
