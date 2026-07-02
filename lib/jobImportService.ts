import OpenAI, { toFile } from 'openai';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { DocumentAiPage } from '@/lib/jobImportDocumentAi';
import { extractTextFromPdfWithDocumentAi } from '@/lib/jobImportDocumentAi';
import type {
  ImportDuplicateAction,
  ImportDuplicateDecision,
  ImportDuplicateSnapshot,
  ImportCorrectionSignal,
  ImportLineResolutionSource,
  ImportFieldCandidate,
  ImportLineItemCandidate,
  JobImportMode,
  JobImportTargetContext,
  JobImportIdentifierMismatch,
  ImportParsedJobInfo,
  ImportParsedLineItem,
  ImportSourceKind,
  ImportWarning,
  JobImportDraftAccessGrant,
  JobImportDraftState,
  JobImportListPage,
  JobImportListSummary,
  JobImportListStatus,
  JobImportRecordResponse,
  JobImportReviewSnapshot,
} from '@/lib/jobImportTypes';
import { getPartDetails } from '@/lib/partsDatabase';
import { checkJobExists, createJobWithMerge, getNextListNumber } from '@/lib/jobsDatabase';
import {
  isJobLineQuantityValid,
  MAX_JOB_LINE_QUANTITY,
  normalizeJobLineQuantity,
} from '@/lib/quantityMath';
import { grantCreatorJobAccess } from '@/lib/permissions';
import {
  applyResolvedInitialAccessGrants,
  resolveInitialAccessGrantsFromBody,
} from '@/lib/initialJobAccessGrants';
import { cache, cacheKeys } from '@/lib/cache';
import { APP_TIME_ZONE, parseDateInputInAppTimeZone, toDateKeyInAppTimeZone } from '@/lib/timezone';
import { sendJobCreatedNotification, sendNoteAddedNotification } from '@/lib/notifications';
import { parseJsonObjectFromLlm } from '@/lib/jobImportJsonParse';
import { updateExistingJobMetadata } from '@/lib/jobMetadataUpdateService';
import { autoAddEligibleUsersToJob } from '@/lib/autoAddJobAccess';
import { normalizeListContextForLookup, normalizeListNumber, LIST_CONTEXT_ALL } from '@/lib/jobListContext';
import { parseTfMaterialPicksheet } from '@/lib/jobImportTfParser';
import { parseHydraTecExport } from '@/lib/jobImportHydraTecParser';
import { deleteR2Object } from '@/lib/r2';
import {
  addOnePageOverlapBetweenChunks,
  buildGreedyPageChunks,
  buildOrderedMaterialPages,
  chunkPageRangeLabel,
  dedupeAdjacentRawLineItems,
  runBoundedPool,
} from '@/lib/jobImportChunkedParse';
import {
  NO_PARTS_PLACEHOLDER_PART_NUMBER,
  normalizeJobImportIntent,
  shouldUseHeaderStubImportPath,
  type JobImportIntent,
} from '@/lib/jobImportConstants';

type JobImport = any;
const prismaAny = prisma as any;

type RawAiFieldCandidate = {
  value?: string | null;
  sourceKind?: ImportSourceKind | string | null;
  confidence?: number | null;
  note?: string | null;
  selected?: boolean;
};

type RawAiLineItem = {
  partNumber?: string | null;
  quantityNeeded?: number | null;
  quantityFab?: number | null;
  quantityLoose?: number | null;
  description?: string | null;
  unitOfMeasurement?: string | null;
  type?: string | null;
  sourceNeeded?: number | null;
  sourceFab?: number | null;
  sourceLoose?: number | null;
  uomFromPdf?: string | null;
  warnings?: string[] | null;
};

type RawAiResponse = {
  jobInfo?: Partial<Record<keyof ImportParsedJobInfo, string | null>>;
  fieldCandidates?: Partial<Record<keyof ImportParsedJobInfo, RawAiFieldCandidate[]>>;
  handwrittenNotes?: string[] | null;
  lineItems?: RawAiLineItem[] | null;
};

type RawVisionResponse = {
  lineItems?: RawAiLineItem[] | null;
};

type SaveReviewInput = {
  reviewSnapshot: JobImportReviewSnapshot;
  draftState?: Partial<JobImportDraftState> | null;
};

type CommitJobImportInput = {
  reviewSnapshot: JobImportReviewSnapshot;
  /** Optional initial JobAccess grants (same shape as POST /api/jobs/create). */
  accessGrants?: unknown;
  initialNote?: {
    content?: string | null;
    hasAttachments?: boolean;
  } | null;
};

type CommitJobImportActor = {
  email: string;
  name?: string | null;
  role?: string | null;
};

const OPENAI_MODEL = process.env.JOB_IMPORT_OPENAI_MODEL?.trim() || 'gpt-4o';
const VISION_OPENAI_MODEL = process.env.JOB_IMPORT_VISION_MODEL?.trim() || OPENAI_MODEL;

/** gpt-4o supports up to 16,384 output tokens; a lower cap truncates JSON and breaks parsing on multi-page picklists. */
function getJobImportParseMaxTokens(): number {
  const raw = process.env.JOB_IMPORT_OPENAI_PARSE_MAX_TOKENS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, 4_096), 128_000);
    }
  }
  return 16_384;
}
const PARSER_VERSION = 'job-import-v3';
/** Short PDFs with unknown TF layout but strong LLM-parsed headers use header-only path (no material rows). */
const MAX_PAGES_HEADER_STUB_LLM_FALLBACK = 3;
const REQUIRED_FIELDS: Array<keyof ImportParsedJobInfo> = ['jobNumber', 'jobName', 'deliveryDate'];

function rawAiHeaderHasStubRequiredFields(
  headerResponse: RawAiResponse | null | undefined,
  sourceFileName: string,
): boolean {
  const fileIds = deriveIdentifiersFromFileName(sourceFileName);
  const j = headerResponse?.jobInfo || {};
  const jobNumber = normalizeText(j.jobNumber) || normalizeText(fileIds.jobNumber);
  const jobName = normalizeText(j.jobName);
  const deliveryRaw = normalizeText(j.deliveryDate) || normalizeText(j.stocklistDeliveryShipDate);
  const delivery = deliveryRaw ? parseDateTokenToIso(deliveryRaw) : '';
  return Boolean(jobNumber && jobName && delivery);
}

function shouldUseHeaderStubLlmFallback(
  pageCount: number,
  layoutProfile: 'tf_material_picksheet_v1' | 'unknown',
  deterministicLineCount: number,
  headerResponse: RawAiResponse,
  sourceFileName: string,
): boolean {
  if (deterministicLineCount > 0) return false;
  if (pageCount > MAX_PAGES_HEADER_STUB_LLM_FALLBACK) return false;
  if (layoutProfile !== 'unknown') return false;
  return rawAiHeaderHasStubRequiredFields(headerResponse, sourceFileName);
}
const JOB_INFO_FIELDS: Array<keyof ImportParsedJobInfo> = [
  'jobNumber',
  'jobName',
  'listNumber',
  'area',
  'locationShipTo',
  'stocklistDeliveryShipDate',
  'listedBy',
  'deliveryDate',
];
const CRITICAL_HANDWRITTEN_FIELDS: Array<keyof ImportParsedJobInfo> = [
  'locationShipTo',
  'stocklistDeliveryShipDate',
  'deliveryDate',
];
const LOCKED_IDENTIFIER_FIELDS: Array<keyof Pick<ImportParsedJobInfo, 'jobNumber' | 'jobName' | 'listNumber'>> = [
  'jobNumber',
  'jobName',
  'listNumber',
];

const JOB_IMPORT_PROMPT = `You parse Total Fire Protection material picksheets from OCR text.

Return one JSON object with these top-level keys:
- jobInfo
- fieldCandidates
- handwrittenNotes
- lineItems

Rules:
- Focus on Total Fire Protection material picksheets and scanned PDFs with handwritten annotations.
- Use the OCR text only. Never invent values.
- Preserve line-item order exactly as it appears in the material table.
- Never merge adjacent rows unless the OCR text clearly shows one row.
- jobInfo fields: jobNumber, jobName, listNumber, area, locationShipTo, stocklistDeliveryShipDate, listedBy, deliveryDate
- Dates must be YYYY-MM-DD when possible. If unknown, use null.
- lineItems should contain partNumber, quantityNeeded, quantityFab, quantityLoose, description, unitOfMeasurement, sourceNeeded, sourceFab, sourceLoose, uomFromPdf, warnings.
- fieldCandidates must be an object keyed by jobInfo field name. Each value is an array of candidates with value, sourceKind, confidence, note, and selected.
- sourceKind must be one of printed, handwritten, ai-derived.
- If handwriting changes a critical field like deliveryDate or locationShipTo, include both the printed and handwritten candidates.
- handwrittenNotes should contain non-critical handwritten notes or annotations that should remain visible during review.
- Include every line item you can identify from the material section.
- Return JSON only.`;

const JOB_IMPORT_VISION_PROMPT = `You verify Total Fire Protection material picksheet line items from an uploaded PDF and OCR grounding text.

Return one JSON object with only this key:
- lineItems

Rules:
- Use the uploaded PDF pages as the primary source of truth and use OCR text only as grounding help.
- Extract only material table rows in top-to-bottom order.
- Never invent rows that are not visible on the page.
- Keep adjacent rows separate unless the page clearly shows one merged row.
- Each line item must include: partNumber, quantityNeeded, quantityFab, quantityLoose, description, unitOfMeasurement, sourceNeeded, sourceFab, sourceLoose, uomFromPdf, warnings.
- Prefer exact part numbers from the PDF even if OCR text is noisy.
- If a field is unreadable, use null rather than guessing.
- Return JSON only.`;

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  return new OpenAI({ apiKey });
}

function sanitizeStorageFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildJobImportStorageKey(importId: string, fileName: string): string {
  return `job-imports/${importId}/${sanitizeStorageFileName(fileName)}`;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizePartNumber(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, '').toUpperCase();
}

const DEPRECATED_CATALOG_WARNING_CODES = new Set([
  'catalog_description_mismatch',
  'catalog_uom_mismatch',
]);

const DEPRECATED_CATALOG_WARNING_MESSAGES = new Set([
  'catalog description mismatch',
  'catalog uom mismatch',
  'part description does not match the catalog record.',
  'part uom does not match the catalog record.',
]);

function computeFileHash(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeForComparison(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase().replace(/\s+/g, ' ');
}

function isDeprecatedCatalogWarning(value: string | null | undefined): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  if (DEPRECATED_CATALOG_WARNING_CODES.has(normalized)) return true;
  return Array.from(DEPRECATED_CATALOG_WARNING_MESSAGES).some((message) => normalized.includes(message));
}

function filterDeprecatedCatalogWarnings(values: Array<string | null | undefined>): string[] {
  return dedupeStrings(values).filter((value) => !isDeprecatedCatalogWarning(value));
}

function descriptionsLookCompatible(left: string | null | undefined, right: string | null | undefined): boolean | null {
  const leftNormalized = normalizeForComparison(left);
  const rightNormalized = normalizeForComparison(right);
  if (!leftNormalized || !rightNormalized) return null;
  if (leftNormalized === rightNormalized) return true;
  return leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized);
}

function unitsLookCompatible(left: string | null | undefined, right: string | null | undefined): boolean | null {
  const leftNormalized = normalizeForComparison(left);
  const rightNormalized = normalizeForComparison(right);
  if (!leftNormalized || !rightNormalized) return null;
  return leftNormalized === rightNormalized;
}

function createLineItemCandidate(
  source: ImportLineItemCandidate['source'],
  item: Pick<
    ImportParsedLineItem,
    'partNumber' | 'quantityNeeded' | 'quantityFab' | 'quantityLoose' | 'description' | 'unitOfMeasurement'
  >,
  confidenceScore: number | null,
  note?: string | null,
): ImportLineItemCandidate {
  return {
    source,
    partNumber: item.partNumber,
    quantityNeeded: item.quantityNeeded,
    quantityFab: item.quantityFab,
    quantityLoose: item.quantityLoose,
    description: item.description,
    unitOfMeasurement: item.unitOfMeasurement,
    confidenceScore,
    note: note || null,
  };
}

function getLineItemRowOrder(item: Pick<ImportParsedLineItem, 'rowOrder' | 'id'>, index: number): number {
  return typeof item.rowOrder === 'number' && Number.isFinite(item.rowOrder) ? item.rowOrder : index + 1;
}

function sortLineItemsByRowOrder<T extends Pick<ImportParsedLineItem, 'rowOrder' | 'id'>>(lineItems: T[]): T[] {
  return [...lineItems].sort((left, right) => {
    const leftOrder = getLineItemRowOrder(left, 0);
    const rightOrder = getLineItemRowOrder(right, 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}

function reindexLineItemsByOrder(lineItems: ImportParsedLineItem[]): ImportParsedLineItem[] {
  return sortLineItemsByRowOrder(lineItems).map((item, index) => ({
    ...item,
    rowOrder: index + 1,
  }));
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeJobLineQuantity(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/[, ]+/g, '').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric)) {
      return normalizeJobLineQuantity(numeric);
    }
  }
  return 0;
}

function validateCommitLineItemQuantities(lineItems: ImportParsedLineItem[]): void {
  const invalid: string[] = [];

  for (const item of lineItems) {
    if (item.partNumber === NO_PARTS_PLACEHOLDER_PART_NUMBER) {
      continue;
    }

    const checks: Array<[string, number | null | undefined]> = [
      ['needed', item.quantityNeeded],
      ['fab', item.quantityFab],
      ['loose', item.quantityLoose],
    ];

    for (const [label, qty] of checks) {
      if (!isJobLineQuantityValid(qty)) {
        invalid.push(`${item.partNumber} (${label}: ${Number(qty).toLocaleString()})`);
      }
    }
  }

  if (invalid.length === 0) {
    return;
  }

  const preview = invalid.slice(0, 5).join('; ');
  const suffix = invalid.length > 5 ? `; and ${invalid.length - 5} more` : '';
  throw new Error(
    `These line items have quantities that are too large to save (likely OCR errors). Fix or remove them before creating the job: ${preview}${suffix}. Maximum allowed per line is ${MAX_JOB_LINE_QUANTITY.toLocaleString()}.`,
  );
}

function parseDateTokenToIso(rawValue: unknown): string {
  const text = normalizeText(rawValue);
  if (!text) return '';

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!mdy) return '';

  const month = Number(mdy[1]);
  const day = Number(mdy[2]);
  let year = Number(mdy[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function deriveIdentifiersFromFileName(fileName: string): { jobNumber: string; listNumber: string } {
  const baseName = fileName.replace(/\.[^.]+$/, '').trim();
  const match = baseName.match(/^([A-Za-z0-9-]+)[_-](\d{1,4})$/);
  return {
    jobNumber: match?.[1]?.trim() || '',
    listNumber: match?.[2]?.trim() || '',
  };
}

function createBlankJobInfo(): ImportParsedJobInfo {
  return {
    jobNumber: '',
    jobName: '',
    listNumber: '',
    area: '',
    locationShipTo: '',
    stocklistDeliveryShipDate: '',
    listedBy: '',
    deliveryDate: '',
  };
}

function toIsoDate(value: Date | null | undefined): string {
  return value ? toDateKeyInAppTimeZone(value) : '';
}

function buildCurrentJobInfoFromRow(row: {
  jobNumber: string;
  jobName: string;
  listNumber: string;
  area: string | null;
  locationShipTo: string | null;
  stocklistDeliveryShipDate: Date | null;
  listedBy: string | null;
  deliveryDate: Date | null;
}): ImportParsedJobInfo {
  return {
    jobNumber: row.jobNumber,
    jobName: row.jobName,
    listNumber: normalizeListNumber(row.listNumber),
    area: row.area || '',
    locationShipTo: row.locationShipTo || '',
    stocklistDeliveryShipDate: toIsoDate(row.stocklistDeliveryShipDate),
    listedBy: row.listedBy || '',
    deliveryDate: toIsoDate(row.deliveryDate),
  };
}

async function getAvailableListNumbersForJob(jobNumber: string): Promise<string[]> {
  const rows = await prisma.job.findMany({
    where: { jobNumber: jobNumber.trim() },
    select: { listNumber: true },
    distinct: ['listNumber'],
    orderBy: { listNumber: 'asc' },
  });

  return rows
    .map((row) => normalizeListNumber(row.listNumber))
    .filter((value, index, array) => array.indexOf(value) === index);
}

async function getCurrentJobInfo(jobNumber: string, listNumber: string): Promise<ImportParsedJobInfo | null> {
  const row = await prisma.job.findFirst({
    where: {
      jobNumber: jobNumber.trim(),
      listNumber: normalizeListNumber(listNumber),
    },
    orderBy: [
      { lineOrder: 'asc' },
      { partNumber: 'asc' },
    ],
    select: {
      jobNumber: true,
      jobName: true,
      listNumber: true,
      area: true,
      locationShipTo: true,
      stocklistDeliveryShipDate: true,
      listedBy: true,
      deliveryDate: true,
    },
  });

  return row ? buildCurrentJobInfoFromRow(row) : null;
}

async function resolveExistingJobTargetContext(params: {
  targetJobNumber: string;
  targetJobName?: string | null;
  targetListNumber?: string | null;
  existingSnapshot?: JobImportReviewSnapshot | null;
}): Promise<{ targetContext: JobImportTargetContext; currentJobInfo: ImportParsedJobInfo | null }> {
  const targetJobNumber = normalizeText(params.targetJobNumber);
  if (!targetJobNumber) {
    throw new Error('A target jobNumber is required for an existing-job PDF update.');
  }

  const availableListNumbers = await getAvailableListNumbersForJob(targetJobNumber);
  if (availableListNumbers.length === 0) {
    throw new Error(`No lists were found for job ${targetJobNumber}.`);
  }

  const requestedListNumber =
    normalizeText(params.existingSnapshot?.targetContext?.listNumber) ||
    normalizeText(params.targetListNumber);
  const launchedFromAllLists =
    params.existingSnapshot?.targetContext?.launchedFromAllLists ??
    (!requestedListNumber || requestedListNumber === LIST_CONTEXT_ALL);
  const requiresListSelection = launchedFromAllLists && availableListNumbers.length > 1;
  const resolvedListNumber = availableListNumbers.includes(normalizeListNumber(requestedListNumber))
    ? normalizeListNumber(requestedListNumber)
    : availableListNumbers[0];
  const currentJobInfo = await getCurrentJobInfo(targetJobNumber, resolvedListNumber);

  return {
    targetContext: {
      jobNumber: targetJobNumber,
      jobName: normalizeText(params.targetJobName) || currentJobInfo?.jobName || null,
      listNumber: resolvedListNumber,
      availableListNumbers,
      lockedIdentifiers: true,
      requiresListSelection,
      listSelectionConfirmed:
        params.existingSnapshot?.targetContext?.listSelectionConfirmed ??
        (!requiresListSelection && !!resolvedListNumber),
      launchedFromAllLists,
    },
    currentJobInfo,
  };
}

function normalizeCandidateSourceKind(value: unknown): ImportSourceKind {
  if (value === 'printed' || value === 'handwritten' || value === 'user-edited') return value;
  return 'ai-derived';
}

function dedupeCandidates(candidates: ImportFieldCandidate[]): ImportFieldCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceKind}::${candidate.value || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countWarnings(warnings: ImportWarning[]): Record<string, number> {
  return warnings.reduce<Record<string, number>>((acc, warning) => {
    acc[warning.severity] = (acc[warning.severity] || 0) + 1;
    return acc;
  }, {});
}

function toJobImportMode(value: unknown): JobImportMode {
  return value === 'EXISTING_JOB_UPDATE' ? 'existing_job_update' : 'new_job_import';
}

function coerceReviewSnapshot(value: Prisma.JsonValue | null): JobImportReviewSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as JobImportReviewSnapshot;
}

function coerceJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDraftAccessGrants(value: unknown): JobImportDraftAccessGrant[] {
  if (!Array.isArray(value)) return [];
  const byEmail = new Map<string, JobImportDraftAccessGrant>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const userEmail = typeof (entry as { userEmail?: unknown }).userEmail === 'string'
      ? (entry as { userEmail: string }).userEmail.trim()
      : '';
    if (!userEmail) continue;
    byEmail.set(userEmail.toLowerCase(), { userEmail });
  }
  return Array.from(byEmail.values());
}

function normalizeJobImportDraftState(value: unknown): JobImportDraftState {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const lastAutosavedAt =
    typeof obj.lastAutosavedAt === 'string' && obj.lastAutosavedAt.trim()
      ? obj.lastAutosavedAt
      : null;
  return {
    accessGrants: normalizeDraftAccessGrants(obj.accessGrants),
    lastAutosavedAt,
    draftVersion: typeof obj.draftVersion === 'number' && Number.isFinite(obj.draftVersion)
      ? Math.max(1, Math.trunc(obj.draftVersion))
      : 1,
  };
}

function serializeJobImport(jobImport: JobImport): JobImportRecordResponse {
  return {
    id: jobImport.id,
    mode: toJobImportMode(jobImport.mode),
    importIntent: normalizeJobImportIntent(jobImport.importIntent),
    status: jobImport.status as JobImportRecordResponse['status'],
    sourceFileName: jobImport.sourceFileName,
    sourceContentType: jobImport.sourceContentType || null,
    sourceFileSize: jobImport.sourceFileSize,
    sourceDownloadPath: `/api/job-imports/${encodeURIComponent(jobImport.id)}/source`,
    createdBy: jobImport.createdBy,
    createdAt: jobImport.createdAt.toISOString(),
    updatedAt: jobImport.updatedAt.toISOString(),
    committedAt: jobImport.committedAt ? jobImport.committedAt.toISOString() : null,
    committedJobNumber: jobImport.committedJobNumber || null,
    committedListNumber: jobImport.committedListNumber || null,
    targetJobNumber: jobImport.targetJobNumber || null,
    targetListNumber: jobImport.targetListNumber || null,
    targetJobName: jobImport.targetJobName || null,
    errorMessage: jobImport.errorMessage || null,
    rawTextPreview: jobImport.rawText ? jobImport.rawText.slice(0, 4000) : null,
    ocrMetadata: coerceJsonObject(jobImport.ocrMetadata),
    warningSummary: coerceJsonObject(jobImport.warningSummary) as Record<string, number> | null,
    reviewSnapshot: coerceReviewSnapshot(jobImport.reviewSnapshot),
    draftState: normalizeJobImportDraftState(jobImport.draftState),
  };
}

function extractJobInfoSummary(
  reviewSnapshot: Prisma.JsonValue | null,
): JobImportListSummary['jobInfo'] {
  const snapshot = coerceReviewSnapshot(reviewSnapshot);
  if (!snapshot?.jobInfo) return null;
  return {
    jobNumber: normalizeText(snapshot.jobInfo.jobNumber),
    jobName: normalizeText(snapshot.jobInfo.jobName),
    listNumber: normalizeText(snapshot.jobInfo.listNumber),
  };
}

function normalizeFieldCandidates(
  field: keyof ImportParsedJobInfo,
  rawCandidates: RawAiFieldCandidate[] | undefined,
  selectedValue: string,
): ImportFieldCandidate[] {
  const candidates = (rawCandidates || [])
    .map((candidate) => {
      const rawValue = normalizeText(candidate?.value);
      if (!rawValue) return null;
      const normalizedValue =
        field === 'stocklistDeliveryShipDate' || field === 'deliveryDate'
          ? parseDateTokenToIso(rawValue)
          : rawValue;
      if (!normalizedValue) return null;
      return {
        value: normalizedValue,
        sourceKind: normalizeCandidateSourceKind(candidate?.sourceKind),
        confidence:
          typeof candidate?.confidence === 'number' && Number.isFinite(candidate.confidence)
            ? candidate.confidence
            : null,
        note: normalizeOptionalText(candidate?.note),
        selected: candidate?.selected === true,
      } satisfies ImportFieldCandidate;
    })
    .filter(Boolean) as ImportFieldCandidate[];

  if (selectedValue && !candidates.some((candidate) => candidate.value === selectedValue)) {
    candidates.unshift({
      value: selectedValue,
      sourceKind: 'ai-derived',
      confidence: null,
      note: null,
      selected: true,
    });
  }

  return dedupeCandidates(candidates);
}

function chooseCandidateValue(
  field: keyof ImportParsedJobInfo,
  candidates: ImportFieldCandidate[],
  fallbackValue: string,
): { value: string; candidates: ImportFieldCandidate[]; usedHandwritten: boolean } {
  const normalizedFallback =
    field === 'stocklistDeliveryShipDate' || field === 'deliveryDate'
      ? parseDateTokenToIso(fallbackValue)
      : normalizeText(fallbackValue);

  let working = [...candidates];
  if (normalizedFallback && !working.some((candidate) => candidate.value === normalizedFallback)) {
    working.unshift({
      value: normalizedFallback,
      sourceKind: 'ai-derived',
      confidence: null,
      note: null,
      selected: true,
    });
  }

  if (working.length === 0) {
    return { value: normalizedFallback, candidates: [], usedHandwritten: false };
  }

  const explicitlySelected = working.find((candidate) => candidate.selected && candidate.value);
  const handwrittenPreferred =
    CRITICAL_HANDWRITTEN_FIELDS.includes(field)
      ? working.find((candidate) => candidate.sourceKind === 'handwritten' && candidate.value)
      : null;
  const bestConfidence = [...working]
    .filter((candidate) => candidate.value)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  const chosen = explicitlySelected || handwrittenPreferred || bestConfidence || working[0];

  working = working.map((candidate) => ({
    ...candidate,
    selected: candidate.value === chosen.value && candidate.sourceKind === chosen.sourceKind,
  }));

  return {
    value: chosen.value || '',
    candidates: working,
    usedHandwritten: chosen.sourceKind === 'handwritten',
  };
}

function ensureUserEditedCandidate(
  candidates: ImportFieldCandidate[] | undefined,
  value: string,
): ImportFieldCandidate[] {
  const normalizedValue = normalizeText(value);
  const existing = [...(candidates || [])];
  const existingIndex = existing.findIndex((candidate) => candidate.value === normalizedValue);

  if (!normalizedValue) {
    return existing.map((candidate) => ({ ...candidate, selected: false }));
  }

  if (existingIndex >= 0) {
    return existing.map((candidate, index) => ({ ...candidate, selected: index === existingIndex }));
  }

  return [
    {
      value: normalizedValue,
      sourceKind: 'user-edited',
      confidence: null,
      note: 'Updated during review.',
      selected: true,
    },
    ...existing.map((candidate) => ({ ...candidate, selected: false })),
  ];
}

function normalizeReviewLineItem(
  rawItem: RawAiLineItem | ImportParsedLineItem,
  index: number,
): ImportParsedLineItem | null {
  const partNumber = normalizePartNumber(rawItem.partNumber);
  const loose = toNonNegativeInt(rawItem.quantityLoose);
  const fab = toNonNegativeInt(rawItem.quantityFab);
  const needed = Math.max(toNonNegativeInt(rawItem.quantityNeeded), loose + fab);

  if (!partNumber || needed <= 0) return null;

  const quantityFab = Math.min(fab, needed);
  const quantityLoose = Math.max(loose, needed - quantityFab);

  return {
    id: 'id' in rawItem && normalizeText(rawItem.id) ? normalizeText(rawItem.id) : `${partNumber}-${index + 1}`,
    partNumber,
    quantityNeeded: needed,
    quantityFab,
    quantityLoose,
    description: normalizeOptionalText(rawItem.description),
    unitOfMeasurement: normalizeOptionalText(rawItem.unitOfMeasurement),
    type: normalizeOptionalText(rawItem.type),
    sourceNeeded:
      typeof rawItem.sourceNeeded === 'number' && Number.isFinite(rawItem.sourceNeeded)
        ? rawItem.sourceNeeded
        : needed,
    sourceFab:
      typeof rawItem.sourceFab === 'number' && Number.isFinite(rawItem.sourceFab)
        ? rawItem.sourceFab
        : quantityFab,
    sourceLoose:
      typeof rawItem.sourceLoose === 'number' && Number.isFinite(rawItem.sourceLoose)
        ? rawItem.sourceLoose
        : quantityLoose,
    uomFromPdf: normalizeOptionalText(rawItem.uomFromPdf),
    warnings: Array.isArray(rawItem.warnings)
      ? filterDeprecatedCatalogWarnings(rawItem.warnings.map((warning) => normalizeText(warning)).filter(Boolean))
      : [],
    unknownPart: 'unknownPart' in rawItem ? Boolean(rawItem.unknownPart) : false,
    reviewStatus:
      'reviewStatus' in rawItem && rawItem.reviewStatus
        ? rawItem.reviewStatus
        : 'trusted',
    resolutionSource:
      'resolutionSource' in rawItem && typeof rawItem.resolutionSource === 'string'
        ? (rawItem.resolutionSource as ImportLineResolutionSource)
        : 'ocr',
    confidenceScore:
      'confidenceScore' in rawItem && typeof rawItem.confidenceScore === 'number' && Number.isFinite(rawItem.confidenceScore)
        ? rawItem.confidenceScore
        : null,
    validationFlags:
      'validationFlags' in rawItem && Array.isArray(rawItem.validationFlags)
        ? filterDeprecatedCatalogWarnings(rawItem.validationFlags.map((flag) => normalizeText(String(flag))).filter(Boolean))
        : [],
    verificationWarnings:
      'verificationWarnings' in rawItem && Array.isArray(rawItem.verificationWarnings)
        ? filterDeprecatedCatalogWarnings(
            rawItem.verificationWarnings.map((warning) => normalizeText(String(warning))).filter(Boolean),
          )
        : [],
    arbitrationNotes:
      'arbitrationNotes' in rawItem && Array.isArray(rawItem.arbitrationNotes)
        ? rawItem.arbitrationNotes.map((note) => normalizeText(String(note))).filter(Boolean)
        : [],
    evidence:
      'evidence' in rawItem && rawItem.evidence && typeof rawItem.evidence === 'object'
        ? rawItem.evidence
        : null,
    rowOrder:
      'rowOrder' in rawItem && typeof rawItem.rowOrder === 'number' && Number.isFinite(rawItem.rowOrder)
        ? rawItem.rowOrder
        : index + 1,
    sectionName:
      'sectionName' in rawItem ? normalizeOptionalText(rawItem.sectionName) : null,
    provenance:
      'provenance' in rawItem && rawItem.provenance
        ? rawItem.provenance
        : {
            partNumber: 'ai-derived',
            quantityNeeded: 'ai-derived',
            quantityFab: 'ai-derived',
            description: 'ai-derived',
            unitOfMeasurement: 'ai-derived',
          },
  };
}

function aggregateImportLineItems(items: ImportParsedLineItem[]): ImportParsedLineItem[] {
  const byPartNumber = new Map<string, ImportParsedLineItem>();

  for (const item of items) {
    const existing = byPartNumber.get(item.partNumber);
    if (!existing) {
      byPartNumber.set(item.partNumber, { ...item, warnings: [...item.warnings] });
      continue;
    }

    existing.quantityNeeded += item.quantityNeeded;
    existing.quantityFab = Math.min(existing.quantityNeeded, existing.quantityFab + item.quantityFab);
    existing.quantityLoose += item.quantityLoose;
    existing.description = existing.description || item.description;
    existing.unitOfMeasurement = existing.unitOfMeasurement || item.unitOfMeasurement;
    existing.type = existing.type || item.type;
    existing.warnings = [...existing.warnings, ...item.warnings];
  }

  return Array.from(byPartNumber.values()).map((item, index) => ({
    ...item,
    id: `${item.partNumber}-${index + 1}`,
  }));
}

async function enrichLineItems(
  lineItems: ImportParsedLineItem[],
  warnings: ImportWarning[],
): Promise<ImportParsedLineItem[]> {
  return await Promise.all(
    lineItems.map(async (item) => {
      const partDetails = await getPartDetails(item.partNumber);
      const descriptionMatches = descriptionsLookCompatible(item.description, partDetails.description);
      const unitMatches = unitsLookCompatible(item.unitOfMeasurement, partDetails.unitOfMeasurement);
      const nextValidationFlags = filterDeprecatedCatalogWarnings(item.validationFlags || []);
      const resolvedDescription =
        partDetails.found && normalizeText(partDetails.description)
          ? partDetails.description
          : item.description || partDetails.description;
      const resolvedUnitOfMeasurement =
        partDetails.found && normalizeText(partDetails.unitOfMeasurement)
          ? partDetails.unitOfMeasurement
          : item.unitOfMeasurement || partDetails.unitOfMeasurement;
      const enriched: ImportParsedLineItem = {
        ...item,
        description: resolvedDescription,
        unitOfMeasurement: resolvedUnitOfMeasurement,
        type: item.type || partDetails.type,
        unknownPart: !partDetails.found,
        resolutionSource: item.resolutionSource || 'ocr',
        verificationWarnings: filterDeprecatedCatalogWarnings(item.verificationWarnings || []),
        arbitrationNotes: [...(item.arbitrationNotes || [])],
        warnings: filterDeprecatedCatalogWarnings(item.warnings || []),
        evidence: item.evidence
          ? {
              ...item.evidence,
              catalogMatch: {
                found: partDetails.found,
                description: partDetails.description,
                unitOfMeasurement: partDetails.unitOfMeasurement,
                descriptionMatches,
                unitMatches,
              },
            }
          : {
              page: null,
              bbox: null,
              ocrText: null,
              primaryCandidate: createLineItemCandidate('primary', item, item.confidenceScore, 'Imported row'),
              secondaryCandidate: null,
              catalogMatch: {
                found: partDetails.found,
                description: partDetails.description,
                unitOfMeasurement: partDetails.unitOfMeasurement,
                descriptionMatches,
                unitMatches,
              },
            },
        validationFlags: nextValidationFlags,
      };

      if (!partDetails.found) {
        nextValidationFlags.push('unknown_part');
        warnings.push({
          code: 'unknown_part',
          severity: 'warning',
          message: `Part ${item.partNumber} was not found in the parts database.`,
          lineItemId: item.id,
        });
      }

      return enriched;
    }),
  );
}

async function buildDuplicateSnapshot(
  jobInfo: ImportParsedJobInfo,
  lineItems: ImportParsedLineItem[],
): Promise<ImportDuplicateSnapshot | null> {
  const jobNumber = normalizeText(jobInfo.jobNumber);
  const listNumber = normalizeText(jobInfo.listNumber);
  if (!jobNumber || !listNumber) return null;

  const duplicateCheck = await checkJobExists(jobNumber, listNumber);
  if (!duplicateCheck.exists || !duplicateCheck.existingJob) {
    return {
      exists: false,
      jobNumber,
      jobName: normalizeText(jobInfo.jobName),
      listNumber,
      existingParts: [],
      duplicateParts: [],
      newPartsCount: lineItems.length,
    };
  }

  const existingPartsByNumber = new Map(
    duplicateCheck.existingJob.existingParts.map((item) => [item.partNumber, item]),
  );

  return {
    exists: true,
    jobNumber,
    jobName: duplicateCheck.existingJob.jobName,
    listNumber,
    existingParts: duplicateCheck.existingJob.existingParts,
    duplicateParts: lineItems
      .filter((item) => existingPartsByNumber.has(item.partNumber))
      .map((item) => {
        const existing = existingPartsByNumber.get(item.partNumber)!;
        return {
          partNumber: item.partNumber,
          description: item.description || existing.description,
          existingQuantityNeeded: existing.quantityNeeded,
          existingQuantityFab: existing.quantityFab,
          incomingQuantityNeeded: item.quantityNeeded,
          incomingQuantityFab: item.quantityFab,
        };
      }),
    newPartsCount: lineItems.filter((item) => !existingPartsByNumber.has(item.partNumber)).length,
  };
}

function buildVerifierLineItems(
  rawResponse: Pick<RawAiResponse, 'lineItems'> | Pick<RawVisionResponse, 'lineItems'> | null | undefined,
  sourceLabel: 'secondary' | 'primary',
  resolutionSource: ImportLineResolutionSource,
): ImportParsedLineItem[] {
  return (rawResponse?.lineItems || [])
    .map((item, index) => normalizeReviewLineItem(item, index))
    .filter((item): item is ImportParsedLineItem => !!item)
    .map((item) => ({
      ...item,
      reviewStatus: item.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted',
      resolutionSource,
      confidenceScore: item.confidenceScore ?? null,
      validationFlags: [...(item.validationFlags || [])],
      verificationWarnings: [...(item.verificationWarnings || [])],
      arbitrationNotes: [...(item.arbitrationNotes || [])],
      evidence: item.evidence
        ? item.evidence
        : {
            page: null,
            bbox: null,
            ocrText: null,
            primaryCandidate:
              sourceLabel === 'primary'
                ? createLineItemCandidate('primary', item, item.confidenceScore, 'Primary parse')
                : null,
            secondaryCandidate:
              sourceLabel === 'secondary'
                ? createLineItemCandidate('secondary', item, item.confidenceScore, 'Vision verifier')
                : null,
            catalogMatch: null,
          },
    }));
}

function isValidPartNumberForArbitration(partNumber: string): boolean {
  return /^[A-Z0-9-]{5,}$/.test(normalizePartNumber(partNumber));
}

function getLineItemStructuralScore(item: ImportParsedLineItem | null | undefined): number {
  if (!item) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (isValidPartNumberForArbitration(item.partNumber)) score += 4;
  if (item.quantityNeeded > 0) score += 2;
  if (item.quantityNeeded === item.quantityLoose + item.quantityFab) score += 2;
  if (normalizeText(item.description)) score += 1.5;
  if (normalizeText(item.unitOfMeasurement)) score += 0.5;
  score += Math.max(0, Math.min(1, item.confidenceScore ?? 0)) * 2;
  score -= (item.validationFlags || []).length * 0.6;
  return score;
}

function cloneLineItemForArbitration(item: ImportParsedLineItem): ImportParsedLineItem {
  return {
    ...item,
    warnings: [...(item.warnings || [])],
    validationFlags: [...(item.validationFlags || [])],
    verificationWarnings: [...(item.verificationWarnings || [])],
    arbitrationNotes: [...(item.arbitrationNotes || [])],
    provenance: item.provenance ? { ...item.provenance } : item.provenance,
    evidence: item.evidence
      ? {
          ...item.evidence,
          primaryCandidate: item.evidence.primaryCandidate ? { ...item.evidence.primaryCandidate } : null,
          secondaryCandidate: item.evidence.secondaryCandidate ? { ...item.evidence.secondaryCandidate } : null,
          catalogMatch: item.evidence.catalogMatch ? { ...item.evidence.catalogMatch } : null,
          bbox: item.evidence.bbox ? { ...item.evidence.bbox } : null,
        }
      : null,
  };
}

function buildHumanWarning(code: string): string {
  switch (code) {
    case 'row_auto_corrected_from_vision':
      return 'Row auto-corrected from the PDF verification pass.';
    case 'possible_row_merge_corrected':
      return 'Possible merged row detected and corrected automatically.';
    case 'vision_disagreement_retained_ocr':
      return 'Verification disagreed, so the more reliable OCR/layout row was kept.';
    case 'vision_added_row':
      return 'A row was added from the PDF verification pass.';
    default:
      return code.replace(/_/g, ' ');
  }
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function mergeItemFromSources(
  primary: ImportParsedLineItem,
  secondary: ImportParsedLineItem,
): { item: ImportParsedLineItem; usedVision: boolean } {
  const merged = cloneLineItemForArbitration(primary);
  let usedVision = false;
  const nextWarnings = new Set([...(merged.verificationWarnings || [])]);
  const nextNotes = new Set([...(merged.arbitrationNotes || [])]);
  const primaryScore = getLineItemStructuralScore(primary);
  const secondaryScore = getLineItemStructuralScore(secondary);

  if (
    primary.quantityNeeded !== primary.quantityLoose + primary.quantityFab &&
    secondary.quantityNeeded === secondary.quantityLoose + secondary.quantityFab
  ) {
    merged.quantityNeeded = secondary.quantityNeeded;
    merged.quantityFab = secondary.quantityFab;
    merged.quantityLoose = secondary.quantityLoose;
    merged.sourceNeeded = secondary.sourceNeeded ?? secondary.quantityNeeded;
    merged.sourceFab = secondary.sourceFab ?? secondary.quantityFab;
    merged.sourceLoose = secondary.sourceLoose ?? secondary.quantityLoose;
    merged.provenance = {
      ...merged.provenance,
      quantityNeeded: 'ai-derived',
      quantityFab: 'ai-derived',
    };
    usedVision = true;
    nextWarnings.add('row_auto_corrected_from_vision');
    nextNotes.add('vision corrected quantity arithmetic');
  }

  if (!normalizeText(merged.description) || (normalizeText(secondary.description) && !descriptionsLookCompatible(primary.description, secondary.description))) {
    if (normalizeText(secondary.description) && secondaryScore >= primaryScore - 0.5) {
      merged.description = secondary.description;
      merged.provenance = { ...merged.provenance, description: 'ai-derived' };
      usedVision = true;
      nextWarnings.add('row_auto_corrected_from_vision');
      nextNotes.add('vision supplied preferred description');
    }
  }

  if (!normalizeText(merged.unitOfMeasurement) && normalizeText(secondary.unitOfMeasurement)) {
    merged.unitOfMeasurement = secondary.unitOfMeasurement;
    merged.uomFromPdf = secondary.uomFromPdf || secondary.unitOfMeasurement;
    merged.provenance = { ...merged.provenance, unitOfMeasurement: 'ai-derived' };
    usedVision = true;
  }

  if (!merged.evidence) {
    merged.evidence = {
      page: secondary.evidence?.page ?? primary.evidence?.page ?? null,
      bbox: secondary.evidence?.bbox ?? primary.evidence?.bbox ?? null,
      ocrText: primary.evidence?.ocrText ?? secondary.evidence?.ocrText ?? null,
      primaryCandidate: createLineItemCandidate('primary', primary, primary.confidenceScore, 'Deterministic TF parser'),
      secondaryCandidate: createLineItemCandidate('secondary', secondary, secondary.confidenceScore, 'Rendered-page vision verifier'),
      catalogMatch: secondary.evidence?.catalogMatch ?? primary.evidence?.catalogMatch ?? null,
    };
  } else {
    merged.evidence = {
      ...merged.evidence,
      primaryCandidate:
        merged.evidence.primaryCandidate ||
        createLineItemCandidate('primary', primary, primary.confidenceScore, 'Deterministic TF parser'),
      secondaryCandidate:
        createLineItemCandidate('secondary', secondary, secondary.confidenceScore, 'Rendered-page vision verifier'),
    };
  }

  merged.verificationWarnings = dedupeStrings([...nextWarnings]);
  merged.arbitrationNotes = dedupeStrings([...nextNotes]);
  merged.warnings = dedupeStrings([...(merged.warnings || []), ...merged.verificationWarnings.map(buildHumanWarning)]);
  merged.resolutionSource = usedVision ? 'merged' : primary.resolutionSource || 'ocr';
  merged.reviewStatus = merged.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted';

  return { item: merged, usedVision };
}

function choosePreferredLineItem(
  primary: ImportParsedLineItem | null,
  secondary: ImportParsedLineItem | null,
): { item: ImportParsedLineItem; resolutionSource: ImportLineResolutionSource; warningCode?: string | null } {
  if (primary && secondary) {
    if (primary.partNumber === secondary.partNumber) {
      const merged = mergeItemFromSources(primary, secondary);
      return {
        item: merged.item,
        resolutionSource: merged.item.resolutionSource || 'merged',
        warningCode: merged.usedVision ? 'row_auto_corrected_from_vision' : null,
      };
    }

    const primaryScore = getLineItemStructuralScore(primary);
    const secondaryScore = getLineItemStructuralScore(secondary);
    if (secondaryScore >= primaryScore + 1.5) {
      const chosen = cloneLineItemForArbitration(secondary);
      chosen.resolutionSource = 'vision';
      chosen.reviewStatus = chosen.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted';
      chosen.verificationWarnings = dedupeStrings([...(chosen.verificationWarnings || []), 'row_auto_corrected_from_vision']);
      chosen.warnings = dedupeStrings([...(chosen.warnings || []), buildHumanWarning('row_auto_corrected_from_vision')]);
      chosen.evidence = {
        page: secondary.evidence?.page ?? primary.evidence?.page ?? null,
        bbox: secondary.evidence?.bbox ?? primary.evidence?.bbox ?? null,
        ocrText: primary.evidence?.ocrText ?? secondary.evidence?.ocrText ?? null,
        primaryCandidate: createLineItemCandidate('primary', primary, primary.confidenceScore, 'Deterministic TF parser'),
        secondaryCandidate: createLineItemCandidate('secondary', secondary, secondary.confidenceScore, 'Rendered-page vision verifier'),
        catalogMatch: secondary.evidence?.catalogMatch ?? primary.evidence?.catalogMatch ?? null,
      };
      return { item: chosen, resolutionSource: 'vision', warningCode: 'row_auto_corrected_from_vision' };
    }
  }

  if (primary) {
    const chosen = cloneLineItemForArbitration(primary);
    chosen.resolutionSource = primary.resolutionSource || 'ocr';
    chosen.reviewStatus = chosen.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted';
    if (secondary && primary.partNumber !== secondary.partNumber) {
      chosen.verificationWarnings = dedupeStrings([...(chosen.verificationWarnings || []), 'vision_disagreement_retained_ocr']);
      chosen.warnings = dedupeStrings([...(chosen.warnings || []), buildHumanWarning('vision_disagreement_retained_ocr')]);
      chosen.evidence = {
        page: chosen.evidence?.page ?? secondary.evidence?.page ?? null,
        bbox: chosen.evidence?.bbox ?? secondary.evidence?.bbox ?? null,
        ocrText: chosen.evidence?.ocrText ?? secondary.evidence?.ocrText ?? null,
        primaryCandidate:
          chosen.evidence?.primaryCandidate ||
          createLineItemCandidate('primary', primary, primary.confidenceScore, 'Deterministic TF parser'),
        secondaryCandidate: createLineItemCandidate('secondary', secondary, secondary.confidenceScore, 'Rendered-page vision verifier'),
        catalogMatch: chosen.evidence?.catalogMatch ?? secondary.evidence?.catalogMatch ?? null,
      };
      return { item: chosen, resolutionSource: chosen.resolutionSource || 'ocr', warningCode: 'vision_disagreement_retained_ocr' };
    }
    return { item: chosen, resolutionSource: chosen.resolutionSource || 'ocr', warningCode: null };
  }

  if (!secondary) {
    throw new Error('Expected at least one line item during arbitration.');
  }

  const chosen = cloneLineItemForArbitration(secondary);
  chosen.resolutionSource = 'fallback';
  chosen.reviewStatus = chosen.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted';
  chosen.verificationWarnings = dedupeStrings([...(chosen.verificationWarnings || []), 'vision_added_row']);
  chosen.warnings = dedupeStrings([...(chosen.warnings || []), buildHumanWarning('vision_added_row')]);
  return { item: chosen, resolutionSource: 'fallback', warningCode: 'vision_added_row' };
}

function arbitrateLineItems(
  primaryItems: ImportParsedLineItem[],
  secondaryItems: ImportParsedLineItem[],
  warnings: ImportWarning[],
): {
  lineItems: ImportParsedLineItem[];
  comparisonSummary: JobImportReviewSnapshot['comparisonSummary'];
  arbitrationSummary: NonNullable<JobImportReviewSnapshot['arbitrationSummary']>;
} {
  const secondaryByPart = new Map<string, ImportParsedLineItem[]>();
  for (const item of secondaryItems) {
    const bucket = secondaryByPart.get(item.partNumber) || [];
    bucket.push(item);
    secondaryByPart.set(item.partNumber, bucket);
  }

  const usedSecondary = new Set<string>();
  let agreedRowCount = 0;
  let disagreedRowCount = 0;
  let usedPrimaryRows = 0;
  let usedVisionRows = 0;
  let mergedRows = 0;
  let fallbackRows = 0;
  const lineItems: ImportParsedLineItem[] = [];

  for (let index = 0; index < primaryItems.length; index += 1) {
    const primaryItem = primaryItems[index];
    const samePartCandidate = (secondaryByPart.get(primaryItem.partNumber) || []).find(
      (candidate) => !usedSecondary.has(candidate.id),
    );
    const sameIndexCandidate = secondaryItems[index] && !usedSecondary.has(secondaryItems[index].id)
      ? secondaryItems[index]
      : null;
    const secondaryItem = samePartCandidate || sameIndexCandidate || null;
    const selection = choosePreferredLineItem(primaryItem, secondaryItem);

    if (secondaryItem) {
      usedSecondary.add(secondaryItem.id);
      if (
        primaryItem.partNumber === secondaryItem.partNumber &&
        primaryItem.quantityNeeded === secondaryItem.quantityNeeded &&
        primaryItem.quantityFab === secondaryItem.quantityFab &&
        primaryItem.quantityLoose === secondaryItem.quantityLoose &&
        descriptionsLookCompatible(primaryItem.description, secondaryItem.description) !== false
      ) {
        agreedRowCount += 1;
      } else {
        disagreedRowCount += 1;
      }
    } else {
      disagreedRowCount += 1;
    }

    if (selection.resolutionSource === 'ocr') usedPrimaryRows += 1;
    if (selection.resolutionSource === 'vision') usedVisionRows += 1;
    if (selection.resolutionSource === 'merged') mergedRows += 1;
    if (selection.resolutionSource === 'fallback') fallbackRows += 1;

    if (selection.warningCode) {
      warnings.push({
        code: selection.warningCode,
        severity: selection.warningCode === 'vision_added_row' ? 'warning' : 'info',
        message: `Row ${selection.item.partNumber} ${buildHumanWarning(selection.warningCode).toLowerCase()}`,
        lineItemId: selection.item.id,
      });
    }

    lineItems.push({
      ...selection.item,
      rowOrder: typeof selection.item.rowOrder === 'number' ? selection.item.rowOrder : index + 1,
      reviewStatus: selection.item.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted',
    });
  }

  for (const secondaryItem of secondaryItems) {
    if (usedSecondary.has(secondaryItem.id)) continue;
    const duplicatePrimary = primaryItems.some((item) => item.partNumber === secondaryItem.partNumber);
    if (duplicatePrimary && getLineItemStructuralScore(secondaryItem) < 8) {
      continue;
    }
    const selection = choosePreferredLineItem(null, secondaryItem);
    fallbackRows += 1;
    warnings.push({
      code: 'vision_added_row',
      severity: 'warning',
      message: `Row ${selection.item.partNumber} was added from the PDF verification pass.`,
      lineItemId: selection.item.id,
    });
    lineItems.push({
      ...selection.item,
      rowOrder: typeof selection.item.rowOrder === 'number' ? selection.item.rowOrder : lineItems.length + 1,
      reviewStatus: selection.item.reviewStatus === 'user_confirmed' ? 'user_confirmed' : 'trusted',
    });
  }

  return {
    lineItems,
    comparisonSummary: {
      primaryRowCount: primaryItems.length,
      secondaryRowCount: secondaryItems.length,
      agreedRowCount,
      disagreedRowCount,
      riskyRowCount: 0,
    },
    arbitrationSummary: {
      usedPrimaryRows,
      usedVisionRows,
      mergedRows,
      fallbackRows,
      warningCount: warnings.length,
    },
  };
}

function buildBlockingIssues(
  warnings: ImportWarning[],
  lineItems: ImportParsedLineItem[],
  formatTrusted: boolean,
  allowEmptyMaterialRows: boolean,
): ImportWarning[] {
  const blockingIssues = warnings.filter((warning) => warning.severity === 'error');

  if (!formatTrusted) {
    blockingIssues.push({
      code: 'format_untrusted',
      severity: 'error',
      message: 'This PDF could not be resolved into a trustworthy TF material table.',
    });
  }

  if (lineItems.length === 0 && !allowEmptyMaterialRows) {
    blockingIssues.push({
      code: 'no_resolved_line_items',
      severity: 'error',
      message: 'No trustworthy material rows were resolved from this PDF.',
    });
  }

  return blockingIssues;
}

function buildCorrectionSignals(
  snapshot: Pick<JobImportReviewSnapshot, 'lineItems' | 'layoutProfile' | 'sourceFileHash' | 'sourceFileName'>,
  importId: string,
): ImportCorrectionSignal[] {
  return sortLineItemsByRowOrder(snapshot.lineItems)
    .filter((item) => item.reviewStatus === 'user_confirmed')
    .map((item) => {
      const original =
        item.evidence?.primaryCandidate ||
        item.evidence?.secondaryCandidate ||
        createLineItemCandidate('user', item, item.confidenceScore, 'User confirmed row');
      return {
        importId,
        sourceFileName: snapshot.sourceFileName,
        sourceFileHash: snapshot.sourceFileHash,
        layoutProfile: snapshot.layoutProfile,
        lineItemId: item.id,
        originalReviewStatus: 'trusted',
        originalItem: {
          partNumber: original.partNumber,
          quantityNeeded: original.quantityNeeded,
          quantityFab: original.quantityFab,
          quantityLoose: original.quantityLoose,
          description: original.description,
          unitOfMeasurement: original.unitOfMeasurement,
        },
        finalItem: {
          partNumber: item.partNumber,
          quantityNeeded: item.quantityNeeded,
          quantityFab: item.quantityFab,
          quantityLoose: item.quantityLoose,
          description: item.description,
          unitOfMeasurement: item.unitOfMeasurement,
        },
        validationFlags: [...item.validationFlags],
      };
    });
}

function buildPageOcrContext(pages: DocumentAiPage[], pageNumbers: number[]): string {
  const selectedPages = pages.filter((page) => pageNumbers.includes(page.pageNumber));
  return selectedPages
    .map((page) => {
      const lines = page.lines
        .slice(0, 180)
        .map((line) => line.text)
        .join('\n');
      return `Page ${page.pageNumber}\n${lines}`;
    })
    .join('\n\n');
}

type VisionAttemptConfig = {
  label: string;
  dpi: number;
  maxPages: number;
  maxOcrChars: number;
};

const VISION_ATTEMPTS: VisionAttemptConfig[] = [
  { label: 'default', dpi: 180, maxPages: 3, maxOcrChars: 12000 },
  { label: 'reduced', dpi: 132, maxPages: 2, maxOcrChars: 8000 },
];

function getVisionPageNumbers(params: {
  preferredPageNumbers: number[];
  pages: DocumentAiPage[];
  maxPages: number;
}): number[] {
  const requested =
    params.preferredPageNumbers.length > 0
      ? params.preferredPageNumbers
      : params.pages.slice(0, params.maxPages).map((page) => page.pageNumber);

  return Array.from(new Set(requested.filter((page) => Number.isFinite(page) && page > 0)))
    .slice(0, params.maxPages)
    .sort((left, right) => left - right);
}

async function runVisionAttempt(
  openai: OpenAI,
  params: {
    rawText: string;
    pages: DocumentAiPage[];
    preferredPageNumbers: number[];
    uploadedFileId: string;
    sourceFileName: string;
  },
  attempt: VisionAttemptConfig,
): Promise<{
  lineItems: ImportParsedLineItem[];
  visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']>;
}> {
  const pageNumbers = getVisionPageNumbers({
    preferredPageNumbers: params.preferredPageNumbers,
    pages: params.pages,
    maxPages: attempt.maxPages,
  });
  const ocrContext = buildPageOcrContext(params.pages, pageNumbers);
  const selectedPagesLabel = pageNumbers.length > 0 ? pageNumbers.join(', ') : 'the visible material pages';
  const response = await openai.responses.create({
    model: VISION_OPENAI_MODEL,
    temperature: 0,
    max_output_tokens: 10000,
    text: { format: { type: 'json_object' } },
    instructions: JOB_IMPORT_VISION_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              `Inspect only PDF page(s): ${selectedPagesLabel}.\n` +
              `The source filename is ${params.sourceFileName}.\n` +
              `Return JSON only.\n` +
              `Use the OCR grounding below only as a helper for those same pages.\n\n` +
              `OCR grounding text:\n${ocrContext || params.rawText.slice(0, attempt.maxOcrChars)}`,
          },
          {
            type: 'input_file',
            file_id: params.uploadedFileId,
          },
        ],
      },
    ],
  });

  const content = response.output_text?.trim();
  if (!content) {
    throw new Error(`OpenAI returned an empty response for PDF-file verification (${attempt.label}).`);
  }

  let parsed: RawVisionResponse;
  try {
    parsed = parseJsonObjectFromLlm<RawVisionResponse>(content);
  } catch (error) {
    throw new Error(`Failed to parse PDF-file verification JSON (${attempt.label}): ${(error as Error).message}`);
  }

  const lineItems = buildVerifierLineItems(parsed, 'secondary', 'vision').map((item, index) => ({
    ...item,
    evidence: item.evidence
      ? {
          ...item.evidence,
          page: item.evidence.page ?? pageNumbers[0] ?? null,
        }
      : {
          page: pageNumbers[0] ?? null,
          bbox: null,
          ocrText: null,
          primaryCandidate: null,
          secondaryCandidate: createLineItemCandidate('secondary', item, item.confidenceScore, 'PDF-file vision verifier'),
          catalogMatch: null,
        },
    rowOrder: typeof item.rowOrder === 'number' ? item.rowOrder : index + 1,
  }));

  return {
    lineItems,
    visionMetadata: {
      renderedPages: pageNumbers,
      imageCount: pageNumbers.length,
      dpi: attempt.dpi,
      imageWidth: null,
      imageHeight: null,
      model: VISION_OPENAI_MODEL,
    },
  };
}

function getOpenAiFileProcessingMaxWaitMs(): number {
  const raw = process.env.JOB_IMPORT_OPENAI_FILE_MAX_WAIT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 120_000;
  return Math.min(Math.max(parsed, 30_000), 600_000);
}

async function uploadPdfForVisionVerification(openai: OpenAI, fileBytes: Buffer, sourceFileName: string): Promise<string> {
  const uploadedFile = await openai.files.create({
    file: await toFile(fileBytes, sourceFileName || 'job-import-source.pdf'),
    purpose: 'user_data',
  });

  await openai.files.waitForProcessing(uploadedFile.id, {
    pollInterval: 500,
    maxWait: getOpenAiFileProcessingMaxWaitMs(),
  });

  return uploadedFile.id;
}

async function parseLineItemsWithVision(params: {
  rawText: string;
  pages: DocumentAiPage[];
  fileBytes: Buffer;
  preferredPageNumbers: number[];
  sourceFileName: string;
}): Promise<{
  lineItems: ImportParsedLineItem[];
  visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']>;
}> {
  const openai = getOpenAiClient();
  let lastError: unknown = null;
  let uploadedFileId: string | null = null;

  try {
    uploadedFileId = await uploadPdfForVisionVerification(openai, params.fileBytes, params.sourceFileName);

    for (const attempt of VISION_ATTEMPTS) {
      try {
        return await runVisionAttempt(
          openai,
          {
            rawText: params.rawText,
            pages: params.pages,
            preferredPageNumbers: params.preferredPageNumbers,
            uploadedFileId,
            sourceFileName: params.sourceFileName,
          },
          attempt,
        );
      } catch (error) {
        lastError = error;
        console.warn('PDF-file verification attempt failed.', {
          attempt: attempt.label,
          dpi: attempt.dpi,
          maxPages: attempt.maxPages,
          maxOcrChars: attempt.maxOcrChars,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw (lastError instanceof Error ? lastError : new Error('PDF-file verification failed.'));
  } finally {
    if (uploadedFileId) {
      try {
        await openai.files.delete(uploadedFileId);
      } catch (cleanupError) {
        console.warn('Job import vision source file cleanup failed.', {
          fileId: uploadedFileId,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
  }
}

async function safeParseLineItemsWithVision(params: {
  rawText: string;
  pages: DocumentAiPage[];
  fileBytes: Buffer;
  preferredPageNumbers: number[];
  sourceFileName: string;
}): Promise<{
  lineItems: ImportParsedLineItem[];
  visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']>;
  warnings: ImportWarning[];
}> {
  try {
    const result = await parseLineItemsWithVision(params);
    return {
      ...result,
      warnings: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF-file verification failed.';
    console.error('Job import PDF-file verification failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      message,
      stack: error instanceof Error ? error.stack : null,
      pageCount: params.pages.length,
      preferredPageNumbers: params.preferredPageNumbers,
    });

    return {
      lineItems: [],
      visionMetadata: {
        renderedPages: [],
        imageCount: 0,
        dpi: 180,
        imageWidth: null,
        imageHeight: null,
        model: null,
      },
      warnings: [
        {
          code: 'vision_verification_failed',
          severity: 'warning',
          message: 'PDF verification failed, so the import used OCR/layout parsing only.',
        },
      ],
    };
  }
}

async function buildReviewSnapshot(params: {
  importId: string;
  rawResponse?: RawAiResponse | null;
  existingSnapshot?: JobImportReviewSnapshot | null;
  sourceFileName: string;
  sourceFileHash?: string | null;
  createdBy: string;
  rawText: string;
  importedAt: string;
  mode: JobImportMode;
  layoutProfile?: JobImportReviewSnapshot['layoutProfile'];
  formatTrusted?: boolean;
  initialWarnings?: ImportWarning[];
  deterministicLineItems?: ImportParsedLineItem[];
  secondaryLineItems?: ImportParsedLineItem[];
  visionMetadata?: JobImportReviewSnapshot['visionMetadata'];
  targetJobNumber?: string | null;
  targetListNumber?: string | null;
  targetJobName?: string | null;
  importIntent?: JobImportIntent;
}): Promise<JobImportReviewSnapshot> {
  const {
    importId,
    rawResponse,
    existingSnapshot,
    sourceFileName,
    sourceFileHash,
    createdBy,
    rawText,
    importedAt,
    mode,
    layoutProfile,
    formatTrusted,
    initialWarnings,
    deterministicLineItems,
    secondaryLineItems,
    visionMetadata,
    targetJobNumber,
    targetListNumber,
    targetJobName,
    importIntent: importIntentParam,
  } = params;
  const importIntent: JobImportIntent = importIntentParam ?? 'full';
  const isHeaderStub = importIntent === 'header_stub';
  const warnings: ImportWarning[] = [...(initialWarnings || [])];
  if (isHeaderStub && (layoutProfile || 'unknown') !== 'tf_material_picksheet_v1') {
    warnings.push({
      code: 'header_stub_layout_unknown',
      severity: 'info',
      message:
        'Classic TF picksheet table headers were not detected in OCR; this import was treated as header-only because job number, name, and delivery date were read from the PDF. Verify fields before commit.',
    });
  }
  const responseJobInfo = rawResponse?.jobInfo || {};
  const fileNameIdentifiers = deriveIdentifiersFromFileName(sourceFileName);
  const parsedJobInfo = createBlankJobInfo();
  let baseJobInfo = createBlankJobInfo();
  let currentJobInfo: ImportParsedJobInfo | null = null;
  let targetContext: JobImportTargetContext | null = null;
  const identifierMismatches: JobImportIdentifierMismatch[] = [];
  let comparisonSummary: JobImportReviewSnapshot['comparisonSummary'] =
    existingSnapshot?.comparisonSummary || {
      primaryRowCount: 0,
      secondaryRowCount: 0,
      agreedRowCount: 0,
      disagreedRowCount: 0,
      riskyRowCount: 0,
    };
  let arbitrationSummary: JobImportReviewSnapshot['arbitrationSummary'] =
    existingSnapshot?.arbitrationSummary || null;

  for (const field of JOB_INFO_FIELDS) {
    const responseValue = normalizeText(responseJobInfo[field]);
    parsedJobInfo[field] =
      field === 'stocklistDeliveryShipDate' || field === 'deliveryDate'
        ? parseDateTokenToIso(responseValue)
        : responseValue;
  }

  if (!parsedJobInfo.jobNumber && fileNameIdentifiers.jobNumber) {
    parsedJobInfo.jobNumber = fileNameIdentifiers.jobNumber;
    warnings.push({
      code: 'job_number_from_filename',
      severity: 'info',
      message: 'Job number was derived from the uploaded file name.',
      field: 'jobNumber',
    });
  }

  if (!parsedJobInfo.listNumber && fileNameIdentifiers.listNumber) {
    parsedJobInfo.listNumber = fileNameIdentifiers.listNumber;
    warnings.push({
      code: 'list_number_from_filename',
      severity: 'info',
      message: 'List number was derived from the uploaded file name.',
      field: 'listNumber',
    });
  }

  if (!parsedJobInfo.listedBy && createdBy) {
    parsedJobInfo.listedBy = createdBy;
    warnings.push({
      code: 'listed_by_defaulted',
      severity: 'info',
      message: 'Listed By defaulted to the importing user.',
      field: 'listedBy',
    });
  }

  if (mode === 'existing_job_update') {
    const resolvedContext = await resolveExistingJobTargetContext({
      targetJobNumber:
        normalizeText(targetJobNumber) ||
        normalizeText(existingSnapshot?.targetContext?.jobNumber),
      targetJobName:
        normalizeText(targetJobName) ||
        normalizeText(existingSnapshot?.targetContext?.jobName),
      targetListNumber:
        normalizeText(existingSnapshot?.targetContext?.listNumber) ||
        normalizeText(targetListNumber),
      existingSnapshot,
    });

    targetContext = resolvedContext.targetContext;
    currentJobInfo = resolvedContext.currentJobInfo;
    baseJobInfo = {
      ...(currentJobInfo || createBlankJobInfo()),
      jobNumber: targetContext.jobNumber || '',
      jobName: targetContext.jobName || currentJobInfo?.jobName || '',
      listNumber: targetContext.listNumber || '',
    };

    for (const field of LOCKED_IDENTIFIER_FIELDS) {
      const parsedValue = normalizeText(parsedJobInfo[field]);
      const targetValue = normalizeText(baseJobInfo[field]);
      if (parsedValue && targetValue && parsedValue !== targetValue) {
        identifierMismatches.push({
          field,
          parsedValue,
          targetValue,
        });
        warnings.push({
          code: 'identifier_mismatch',
          severity: 'warning',
          message: `Parsed ${field} "${parsedValue}" does not match the current job value "${targetValue}". This update will stay locked to the current job.`,
          field,
        });
      }
    }

    if (targetContext.requiresListSelection && !targetContext.listSelectionConfirmed) {
      warnings.push({
        code: 'target_list_selection_required',
        severity: 'warning',
        message: 'Choose the target list before committing this PDF update.',
        field: 'listNumber',
      });
    }
  } else {
    baseJobInfo = parsedJobInfo;
  }

  const fieldCandidates: Partial<Record<keyof ImportParsedJobInfo, ImportFieldCandidate[]>> = {};
  for (const field of JOB_INFO_FIELDS) {
    if (mode === 'existing_job_update' && LOCKED_IDENTIFIER_FIELDS.includes(field as typeof LOCKED_IDENTIFIER_FIELDS[number])) {
      const targetValue = normalizeText(baseJobInfo[field]);
      const parsedValue = normalizeText(parsedJobInfo[field]);
      const identifierCandidates = dedupeCandidates(
        [
          {
            value: targetValue,
            sourceKind: 'ai-derived',
            confidence: 1,
            note: 'Locked to the current job context.',
            selected: true,
          },
          parsedValue && parsedValue !== targetValue
            ? {
                value: parsedValue,
                sourceKind: 'printed',
                confidence: null,
                note: 'Parsed from the uploaded PDF.',
                selected: false,
              }
            : null,
        ].filter(Boolean) as ImportFieldCandidate[],
      );
      fieldCandidates[field] = identifierCandidates;
      baseJobInfo[field] = targetValue;
      continue;
    }

    const responseCandidates = normalizeFieldCandidates(
      field,
      rawResponse?.fieldCandidates?.[field],
      parsedJobInfo[field],
    );
    const fallbackValue =
      existingSnapshot?.jobInfo?.[field] ||
      baseJobInfo[field] ||
      parsedJobInfo[field];
    const workingCandidates =
      existingSnapshot?.fieldCandidates?.[field] && existingSnapshot.jobInfo[field]
        ? ensureUserEditedCandidate(existingSnapshot.fieldCandidates[field], existingSnapshot.jobInfo[field])
        : responseCandidates;
    const { value, candidates, usedHandwritten } = chooseCandidateValue(
      field,
      workingCandidates,
      fallbackValue,
    );

    baseJobInfo[field] = value;
    fieldCandidates[field] = candidates;

    if (usedHandwritten) {
      const printedCandidate = candidates.find((candidate) => candidate.sourceKind === 'printed');
      if (printedCandidate?.value && printedCandidate.value !== value) {
        warnings.push({
          code: 'handwritten_override',
          severity: 'warning',
          message: `${field} was set from handwriting instead of the printed value.`,
          field,
        });
      }
    }
  }

  if (mode === 'new_job_import' && !baseJobInfo.listNumber && baseJobInfo.jobNumber) {
    baseJobInfo.listNumber = await getNextListNumber(baseJobInfo.jobNumber);
    fieldCandidates.listNumber = ensureUserEditedCandidate(fieldCandidates.listNumber, baseJobInfo.listNumber);
    warnings.push({
      code: 'list_number_defaulted',
      severity: 'info',
      message: `List number defaulted to ${baseJobInfo.listNumber}.`,
      field: 'listNumber',
    });
  }

  if (!baseJobInfo.deliveryDate && baseJobInfo.stocklistDeliveryShipDate) {
    baseJobInfo.deliveryDate = baseJobInfo.stocklistDeliveryShipDate;
    fieldCandidates.deliveryDate = ensureUserEditedCandidate(
      fieldCandidates.deliveryDate,
      baseJobInfo.deliveryDate,
    );
    warnings.push({
      code: 'delivery_date_defaulted',
      severity: 'warning',
      message: 'Delivery date defaulted to the stocklist date because no separate delivery date was found.',
      field: 'deliveryDate',
    });
  }

  const verifierLineItems =
    secondaryLineItems && secondaryLineItems.length > 0
      ? sortLineItemsByRowOrder(secondaryLineItems)
          .map((item, index) => normalizeReviewLineItem(item, index))
          .filter((item): item is ImportParsedLineItem => !!item)
      : buildVerifierLineItems(rawResponse, 'secondary', 'vision');
  const existingLineItemsRaw = existingSnapshot?.lineItems ?? [];
  const existingLineItemsFiltered =
    isHeaderStub && existingLineItemsRaw.length > 0
      ? existingLineItemsRaw.filter(
          (item) => normalizePartNumber(item.partNumber) !== normalizePartNumber(NO_PARTS_PLACEHOLDER_PART_NUMBER),
        )
      : existingLineItemsRaw;
  let normalizedLineItems =
    existingLineItemsFiltered.length > 0
      ? sortLineItemsByRowOrder(existingLineItemsFiltered)
          .map((item, index) => normalizeReviewLineItem(item, index))
          .filter((item): item is ImportParsedLineItem => !!item)
      : sortLineItemsByRowOrder(deterministicLineItems || [])
          .map((item, index) => normalizeReviewLineItem(item, index))
          .filter((item): item is ImportParsedLineItem => !!item);

  if (!existingSnapshot) {
    const arbitrated = arbitrateLineItems(normalizedLineItems, verifierLineItems, warnings);
    normalizedLineItems = arbitrated.lineItems;
    comparisonSummary = arbitrated.comparisonSummary;
    arbitrationSummary = arbitrated.arbitrationSummary;
  }

  if (normalizedLineItems.length === 0 && !isHeaderStub) {
    warnings.push({
      code: 'no_line_items',
      severity: 'error',
      message: 'No valid line items were extracted from the document.',
    });
  }

  let enrichedLineItems = reindexLineItemsByOrder(await enrichLineItems(normalizedLineItems, warnings));

  for (const item of enrichedLineItems) {
    if (item.partNumber === NO_PARTS_PLACEHOLDER_PART_NUMBER) {
      continue;
    }
    if (!/^[A-Z0-9-]{5,}$/.test(item.partNumber)) {
      if (!item.validationFlags.includes('invalid_part_number_format')) {
        item.validationFlags.push('invalid_part_number_format');
      }
      warnings.push({
        code: 'invalid_part_number_format',
        severity: 'warning',
        message: `Part number "${item.partNumber}" does not match the expected TF part format.`,
        lineItemId: item.id,
      });
    }

    if (item.quantityNeeded !== item.quantityLoose + item.quantityFab) {
      if (!item.validationFlags.includes('quantity_mismatch')) {
        item.validationFlags.push('quantity_mismatch');
      }
      item.verificationWarnings = dedupeStrings([...(item.verificationWarnings || []), 'possible_row_merge_corrected']);
      item.warnings = dedupeStrings([...(item.warnings || []), buildHumanWarning('possible_row_merge_corrected')]);
      warnings.push({
        code: 'quantity_mismatch',
        severity: 'warning',
        message: `Row ${item.partNumber} still has a quantity arithmetic mismatch after verification.`,
        lineItemId: item.id,
      });
    }

    for (const [field, qty] of [
      ['quantityNeeded', item.quantityNeeded],
      ['quantityFab', item.quantityFab],
      ['quantityLoose', item.quantityLoose],
    ] as const) {
      if (!isJobLineQuantityValid(qty)) {
        if (!item.validationFlags.includes('quantity_overflow')) {
          item.validationFlags.push('quantity_overflow');
        }
        warnings.push({
          code: 'quantity_overflow',
          severity: 'error',
          message: `Part ${item.partNumber} has an invalid ${field} (${Number(qty).toLocaleString()}). This is usually an OCR mistake — correct or remove the row before creating the job.`,
          lineItemId: item.id,
        });
      }
    }
  }

  const partNumberCounts = new Map<string, number>();
  for (const item of enrichedLineItems) {
    partNumberCounts.set(item.partNumber, (partNumberCounts.get(item.partNumber) || 0) + 1);
  }
  for (const item of enrichedLineItems) {
    if ((partNumberCounts.get(item.partNumber) || 0) > 1) {
      item.verificationWarnings = dedupeStrings([...(item.verificationWarnings || []), 'duplicate_part_number']);
      warnings.push({
        code: 'duplicate_part_number',
        severity: 'warning',
        message: `Part ${item.partNumber} appears in multiple resolved rows.`,
        lineItemId: item.id,
      });
    }
  }

  const itemsBySection = new Map<string, ImportParsedLineItem[]>();
  for (const item of enrichedLineItems) {
    const key = item.sectionName || '__none__';
    const existing = itemsBySection.get(key) || [];
    existing.push(item);
    itemsBySection.set(key, existing);
  }
  for (const [sectionName, items] of itemsBySection.entries()) {
    const tailItems = items.slice(-3);
    for (const item of tailItems) {
      if ((item.verificationWarnings || []).includes('vision_disagreement_retained_ocr')) {
        if (!item.validationFlags.includes('tail_row_guard')) {
          item.validationFlags.push('tail_row_guard');
        }
        warnings.push({
          code: 'tail_row_guard',
          severity: 'warning',
          message: `Tail-row verification flagged ${item.partNumber}${sectionName !== '__none__' ? ` in ${sectionName}` : ''}.`,
          lineItemId: item.id,
        });
      }
    }
  }

  const missingRequiredFields = REQUIRED_FIELDS.filter((field) => !normalizeText(baseJobInfo[field])) as Array<keyof ImportParsedJobInfo>;
  for (const field of missingRequiredFields) {
    warnings.push({
      code: 'missing_required_field',
      severity: 'error',
      message: `${field} is required before the import can be committed.`,
      field,
    });
  }

  const duplicateInfo = await buildDuplicateSnapshot(baseJobInfo, enrichedLineItems);
  if (duplicateInfo?.exists) {
    warnings.push({
      code: 'duplicate_job_list',
      severity: 'warning',
      message: `Job ${duplicateInfo.jobNumber} list ${duplicateInfo.listNumber} already exists and needs per-part merge review.`,
      field: 'listNumber',
    });
  }

  const resolvedFormatTrusted =
    existingSnapshot?.formatTrusted ??
    (typeof formatTrusted === 'boolean'
      ? formatTrusted
      : (layoutProfile || 'unknown') === 'tf_material_picksheet_v1');
  const coherentResolvedRows = enrichedLineItems.filter((item) => isValidPartNumberForArbitration(item.partNumber)).length;
  let resolvedFormatTrustedWithArbitration =
    resolvedFormatTrusted ||
    (coherentResolvedRows >= Math.max(3, Math.floor(enrichedLineItems.length * 0.6)) &&
      verifierLineItems.length > 0 &&
      comparisonSummary.secondaryRowCount > 0);

  if (isHeaderStub) {
    const requiredOk = REQUIRED_FIELDS.every((field) => normalizeText(baseJobInfo[field]));
    if (requiredOk) {
      resolvedFormatTrustedWithArbitration = true;
    }
  }

  const blockingIssues = buildBlockingIssues(
    warnings,
    enrichedLineItems,
    resolvedFormatTrustedWithArbitration,
    isHeaderStub,
  );
  const trustedRowCount = enrichedLineItems.length;
  const needsReviewRowCount = 0;
  const correctionSignals = buildCorrectionSignals(
    {
      lineItems: enrichedLineItems,
      layoutProfile: existingSnapshot?.layoutProfile || layoutProfile || 'unknown',
      sourceFileHash: existingSnapshot?.sourceFileHash || sourceFileHash || null,
      sourceFileName,
    },
    importId,
  );

  return {
    mode,
    jobInfo: baseJobInfo,
    currentJobInfo,
    targetContext,
    identifierMismatches,
    fieldCandidates,
    lineItems: enrichedLineItems,
    warnings,
    missingRequiredFields,
    handwrittenNotes: Array.isArray(existingSnapshot?.handwrittenNotes)
      ? existingSnapshot.handwrittenNotes
      : Array.isArray(rawResponse?.handwrittenNotes)
        ? rawResponse.handwrittenNotes.map((note) => normalizeText(note)).filter(Boolean)
        : [],
    duplicateInfo,
    duplicateDecisions: Array.isArray(existingSnapshot?.duplicateDecisions)
      ? existingSnapshot.duplicateDecisions
      : [],
    layoutProfile: existingSnapshot?.layoutProfile || layoutProfile || 'unknown',
    formatTrusted: resolvedFormatTrustedWithArbitration,
    comparisonSummary,
    arbitrationSummary,
    visionMetadata: existingSnapshot?.visionMetadata || visionMetadata || null,
    blockingIssues,
    trustedRowCount,
    needsReviewRowCount,
    sourceFileHash: existingSnapshot?.sourceFileHash || sourceFileHash || null,
    workspaceNote:
      typeof existingSnapshot?.workspaceNote === 'string' ? existingSnapshot.workspaceNote : null,
    correctionSignals,
    parserModel: OPENAI_MODEL,
    parserVersion: PARSER_VERSION,
    ocrCharacterCount: rawText.length,
    importedAt,
    sourceFileName,
  };
}

async function parsePacketWithOpenAi(rawText: string): Promise<RawAiResponse> {
  const openai = getOpenAiClient();
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.1,
    max_tokens: getJobImportParseMaxTokens(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: JOB_IMPORT_PROMPT },
      { role: 'user', content: rawText },
    ],
  });

  const choice = response.choices[0];
  const content = choice?.message?.content?.trim();
  const finishReason = choice?.finish_reason;

  if (!content) {
    throw new Error('OpenAI returned an empty response for job import parsing.');
  }

  try {
    return parseJsonObjectFromLlm<RawAiResponse>(content);
  } catch (error) {
    const base = `Failed to parse OpenAI import response as JSON: ${(error as Error).message}`;
    if (finishReason === 'length') {
      throw new Error(
        `${base} The completion hit the output token limit (finish_reason=length). For large picklists, set JOB_IMPORT_OPENAI_PARSE_MAX_TOKENS as high as your model allows (e.g. 16384 for gpt-4o), or use a model with a larger JSON output cap.`,
      );
    }
    throw new Error(base);
  }
}

async function updateJobImportRecord(importId: string, update: any): Promise<JobImport> {
  return await prismaAny.jobImport.update({
    where: { id: importId },
    data: update,
  });
}

const JOB_IMPORT_HEADER_PROMPT = `You extract Total Fire Protection material picksheet **header** fields from OCR text for the pages provided.

Return one JSON object with ONLY these top-level keys:
- jobInfo
- fieldCandidates
- handwrittenNotes
- lineItems (must be an empty array [])

Rules:
- Use the OCR text only. Never invent values.
- jobInfo fields: jobNumber, jobName, listNumber, area, locationShipTo, stocklistDeliveryShipDate, listedBy, deliveryDate
- Dates must be YYYY-MM-DD when possible. If unknown, use null.
- fieldCandidates must be an object keyed by jobInfo field name. Each value is an array of candidates with value, sourceKind, confidence, note, and selected.
- sourceKind must be one of printed, handwritten, ai-derived.
- handwrittenNotes should contain non-critical handwritten notes visible on these pages.
- Do not extract material table rows; set lineItems to [].
- Return JSON only.`;

const JOB_IMPORT_LINE_ONLY_PROMPT = `You extract **material table line items** from OCR text for the pages provided (and only those pages).

Return one JSON object with ONLY this top-level key:
- lineItems

Rules:
- Use the OCR text only. Never invent values.
- Preserve line-item order exactly as it appears in the material table on these pages.
- Never merge adjacent rows unless the OCR text clearly shows one row.
- Each line item must include: partNumber, quantityNeeded, quantityFab, quantityLoose, description, unitOfMeasurement, sourceNeeded, sourceFab, sourceLoose, uomFromPdf, warnings.
- Return JSON only.`;

function getChunkConcurrency(): number {
  const raw = process.env.JOB_IMPORT_CHUNK_CONCURRENCY?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(Math.max(parsed, 1), 16);
}

function getChunkMaxInputChars(): number {
  const raw = process.env.JOB_IMPORT_CHUNK_MAX_INPUT_CHARS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 48_000;
  return Math.min(Math.max(parsed, 8_000), 500_000);
}

function getChunkMaxSplits(): number {
  const raw = process.env.JOB_IMPORT_CHUNK_MAX_SPLITS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 1), 20);
}

function getChunkLineMaxTokens(): number {
  const raw = process.env.JOB_IMPORT_CHUNK_TEXT_MAX_TOKENS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, 2048), getJobImportParseMaxTokens());
    }
  }
  return Math.min(12_000, getJobImportParseMaxTokens());
}

export async function mergeJobImportParseProgress(
  importId: string,
  partial: Record<string, unknown>,
): Promise<void> {
  const current = await prismaAny.jobImport.findUnique({
    where: { id: importId },
    select: { ocrMetadata: true },
  });
  const existing = coerceJsonObject(current?.ocrMetadata) || {};
  const prevProgress = (existing.parseProgress as Record<string, unknown>) || {};
  const startedAt =
    (typeof prevProgress.startedAt === 'string' && prevProgress.startedAt) || new Date().toISOString();
  const next = {
    ...existing,
    parseProgress: {
      version: 1,
      ...prevProgress,
      ...partial,
      startedAt,
      updatedAt: new Date().toISOString(),
    },
  };
  await prismaAny.jobImport.update({
    where: { id: importId },
    data: { ocrMetadata: next as unknown as Prisma.InputJsonValue },
  });
}

function isLikelyOutputTruncationError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Unterminated string in JSON|Unexpected end of JSON|Unexpected token|finish_reason=length/i.test(msg);
}

function mergeVisionMetadataChunks(
  parts: Array<{ visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']> }>,
): NonNullable<JobImportReviewSnapshot['visionMetadata']> {
  if (parts.length === 0) {
    return {
      renderedPages: [],
      imageCount: 0,
      dpi: 180,
      imageWidth: null,
      imageHeight: null,
      model: null,
    };
  }
  const rendered: number[] = [];
  for (const p of parts) {
    rendered.push(...(p.visionMetadata.renderedPages || []));
  }
  const unique = Array.from(new Set(rendered.filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  const first = parts[0].visionMetadata;
  return {
    renderedPages: unique,
    imageCount: unique.length,
    dpi: first.dpi,
    imageWidth: first.imageWidth,
    imageHeight: first.imageHeight,
    model: first.model,
  };
}

async function parseHeaderWithOpenAi(pages: DocumentAiPage[], headerPageNums: number[]): Promise<RawAiResponse> {
  const openai = getOpenAiClient();
  const userContent = buildPageOcrContext(pages, headerPageNums);
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.1,
    max_tokens: 6000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: JOB_IMPORT_HEADER_PROMPT },
      { role: 'user', content: userContent },
    ],
  });
  const choice = response.choices[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenAI returned an empty response for job import header parsing.');
  }
  let parsed: RawAiResponse;
  try {
    parsed = parseJsonObjectFromLlm<RawAiResponse>(content);
  } catch (error) {
    throw new Error(`Failed to parse OpenAI header JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed.lineItems)) {
    parsed.lineItems = [];
  }
  return parsed;
}

async function parseLineItemsChunkOpenAiOnce(
  pageNums: number[],
  pages: DocumentAiPage[],
): Promise<{ lineItems: RawAiLineItem[]; finishReason: string | null | undefined }> {
  const openai = getOpenAiClient();
  const userContent = buildPageOcrContext(pages, pageNums);
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.1,
    max_tokens: getChunkLineMaxTokens(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: JOB_IMPORT_LINE_ONLY_PROMPT },
      { role: 'user', content: userContent },
    ],
  });
  const choice = response.choices[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    return { lineItems: [], finishReason: choice?.finish_reason };
  }
  let parsed: { lineItems?: RawAiLineItem[] };
  try {
    parsed = parseJsonObjectFromLlm<{ lineItems?: RawAiLineItem[] }>(content);
  } catch (error) {
    throw new Error(
      `Failed to parse OpenAI line-item JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    finishReason: choice?.finish_reason,
  };
}

async function parseLineItemsForPagesWithSplits(
  pageNums: number[],
  pages: DocumentAiPage[],
  depth: number,
): Promise<RawAiLineItem[]> {
  const maxSplits = getChunkMaxSplits();
  try {
    const { lineItems, finishReason } = await parseLineItemsChunkOpenAiOnce(pageNums, pages);
    if (finishReason === 'length' && pageNums.length > 1 && depth < maxSplits) {
      throw new Error('__force_split_length__');
    }
    return lineItems;
  } catch (error) {
    const forceSplit = error instanceof Error && error.message === '__force_split_length__';
    const trunc = forceSplit || isLikelyOutputTruncationError(error);
    if (!trunc || pageNums.length <= 1 || depth >= maxSplits) {
      const [lo, hi] = chunkPageRangeLabel(pageNums);
      throw new Error(
        `Line-item chunk failed (pages ${lo}-${hi}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const mid = Math.max(1, Math.floor(pageNums.length / 2));
    const left = pageNums.slice(0, mid);
    const right = pageNums.slice(mid);
    const [a, b] = await Promise.all([
      parseLineItemsForPagesWithSplits(left, pages, depth + 1),
      parseLineItemsForPagesWithSplits(right, pages, depth + 1),
    ]);
    return [...a, ...b];
  }
}

async function visionLineItemsForChunkPagesHard(params: {
  openai: OpenAI;
  uploadedFileId: string;
  rawText: string;
  pages: DocumentAiPage[];
  sourceFileName: string;
  chunkPageNums: number[];
}): Promise<{
  lineItems: ImportParsedLineItem[];
  visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']>;
}> {
  const maxWin = VISION_ATTEMPTS[0]?.maxPages ?? 3;
  const sorted = Array.from(new Set(params.chunkPageNums.filter((n) => Number.isFinite(n) && n > 0))).sort(
    (a, b) => a - b,
  );
  const windows: number[][] = [];
  for (let i = 0; i < sorted.length; i += maxWin) {
    windows.push(sorted.slice(i, i + maxWin));
  }

  const allLine: ImportParsedLineItem[] = [];
  const metaParts: Array<{ visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']> }> = [];

  for (const window of windows) {
    let lastError: unknown = null;
    let got: {
      lineItems: ImportParsedLineItem[];
      visionMetadata: NonNullable<JobImportReviewSnapshot['visionMetadata']>;
    } | null = null;
    for (const attempt of VISION_ATTEMPTS) {
      try {
        got = await runVisionAttempt(
          params.openai,
          {
            rawText: params.rawText,
            pages: params.pages,
            preferredPageNumbers: window,
            uploadedFileId: params.uploadedFileId,
            sourceFileName: params.sourceFileName,
          },
          attempt,
        );
        break;
      } catch (error) {
        lastError = error;
        console.warn('Vision window attempt failed.', {
          window,
          attempt: attempt.label,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!got) {
      throw new Error(
        `Vision failed for pages ${window.join(', ')}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
    allLine.push(...got.lineItems);
    metaParts.push({ visionMetadata: got.visionMetadata });
  }

  return {
    lineItems: allLine,
    visionMetadata: mergeVisionMetadataChunks(metaParts),
  };
}

export async function createJobImportDraft(params: {
  fileName: string;
  contentType: string | null;
  fileBytes: Buffer;
  createdBy: string;
  mode?: JobImportMode;
  targetJobNumber?: string | null;
  targetListNumber?: string | null;
  targetJobName?: string | null;
  sourceFormat?: 'pdf' | 'hvuf';
}): Promise<JobImport> {
  const importId = randomUUID();
  return await prismaAny.jobImport.create({
    data: {
      id: importId,
      mode: params.mode === 'existing_job_update' ? 'EXISTING_JOB_UPDATE' : 'NEW_JOB_IMPORT',
      sourceFileName: params.fileName,
      sourceContentType: params.contentType,
      sourceFileSize: params.fileBytes.length,
      sourceStorageKey: buildJobImportStorageKey(importId, params.fileName),
      sourceFileBytes: params.fileBytes,
      sourceFormat: params.sourceFormat || 'pdf',
      createdBy: params.createdBy,
      targetJobNumber: normalizeOptionalText(params.targetJobNumber),
      targetListNumber: normalizeOptionalText(params.targetListNumber),
      targetJobName: normalizeOptionalText(params.targetJobName),
    },
  });
}

/**
 * Deterministic counterpart to the PDF/OCR path below. HydraTec's .HVUF
 * export already contains exact TF part numbers and literal (not OCR'd)
 * text, so this skips Document AI and OpenAI entirely — see
 * lib/jobImportHydraTecParser.ts for why a dedicated parser is used instead
 * of the OCR-tuned lib/jobImportTfParser.ts.
 */
/**
 * Checks for an existing (non-failed) draft already parsed from the same
 * HydraTec job/list/Stocklist-Date combination — i.e. the same generation
 * of the same pick sheet, not just the same job/list in general. Lets the
 * watcher upload endpoint skip creating a duplicate draft when HydraLIST's
 * export folder ends up with more than one copy of the same export (e.g.
 * a file re-touched without new content), while still allowing a genuine
 * re-export with an updated Stocklist Date to create a fresh draft.
 */
export async function findDuplicateHydraTecDraft(params: {
  jobNumber: string | null;
  listNumber: string | null;
  stocklistDate: string | null;
}): Promise<JobImport | null> {
  const jobNumber = normalizeOptionalText(params.jobNumber);
  const listNumber = normalizeOptionalText(params.listNumber);
  const stocklistDate = normalizeOptionalText(params.stocklistDate);
  if (!jobNumber || !listNumber || !stocklistDate) return null;

  return await prismaAny.jobImport.findFirst({
    where: {
      parsedJobNumber: jobNumber,
      parsedListNumber: listNumber,
      parsedStocklistDate: stocklistDate,
      status: { not: 'FAILED' },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function parseHydraTecImport(importId: string, jobImport: JobImport): Promise<JobImport> {
  try {
    await mergeJobImportParseProgress(importId, {
      phase: 'merge',
      current: { label: 'Parsing HydraTec export…' },
    });

    const fileBytes = Buffer.from(jobImport.sourceFileBytes!);
    const { jobInfo, deterministicResult } = parseHydraTecExport(fileBytes);
    const sourceFileHash = computeFileHash(fileBytes);

    const rawResponse: RawAiResponse = { jobInfo, lineItems: [] };

    const initialWarnings: ImportWarning[] = deterministicResult.issues
      .filter((issue) => issue.code !== 'incomplete_row')
      .map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        lineItemId: issue.lineItemId || null,
      }));

    const reviewSnapshot = await buildReviewSnapshot({
      importId,
      rawResponse,
      existingSnapshot: coerceReviewSnapshot(jobImport.reviewSnapshot) || undefined,
      sourceFileName: jobImport.sourceFileName,
      sourceFileHash,
      createdBy: jobImport.createdBy,
      rawText: '',
      importedAt: toDateKeyInAppTimeZone(new Date()),
      mode: toJobImportMode(jobImport.mode),
      layoutProfile: 'tf_material_picksheet_v1',
      formatTrusted: deterministicResult.formatTrusted,
      initialWarnings,
      deterministicLineItems: deterministicResult.lineItems,
      secondaryLineItems: deterministicResult.lineItems,
      targetJobNumber: jobImport.targetJobNumber,
      targetListNumber: jobImport.targetListNumber,
      targetJobName: jobImport.targetJobName,
      importIntent: 'full',
    });

    return await updateJobImportRecord(importId, {
      status: 'READY',
      importIntent: 'full',
      rawText: '',
      ocrMetadata: {
        pageCount: deterministicResult.materialPageNumbers.length,
        mimeType: 'application/x-hvuf',
        processorLocation: null,
        layoutProfile: 'tf_material_picksheet_v1',
        pages: [],
        sourceFileHash,
        visionMetadata: null,
      } as unknown as Prisma.InputJsonValue,
      parsedSnapshot: rawResponse as unknown as Prisma.InputJsonValue,
      reviewSnapshot: reviewSnapshot as unknown as Prisma.InputJsonValue,
      warningSummary: countWarnings(reviewSnapshot.warnings) as unknown as Prisma.InputJsonValue,
      duplicateSnapshot: (reviewSnapshot.duplicateInfo || null) as unknown as Prisma.InputJsonValue,
      parsedJobNumber: normalizeOptionalText(jobInfo.jobNumber),
      parsedListNumber: normalizeOptionalText(jobInfo.listNumber),
      parsedStocklistDate: normalizeOptionalText(jobInfo.stocklistDeliveryShipDate),
      errorMessage: null,
    });
  } catch (error) {
    return await updateJobImportRecord(importId, {
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : 'Failed to parse HydraTec import.',
    });
  }
}

export async function parseJobImport(importId: string): Promise<JobImport> {
  const jobImport = await prismaAny.jobImport.findUnique({ where: { id: importId } });
  if (!jobImport) throw new Error('Import session not found.');
  if (!jobImport.sourceFileBytes) throw new Error('Import source file is missing.');

  if (jobImport.sourceFormat === 'hvuf') {
    return await parseHydraTecImport(importId, jobImport);
  }

  try {
    await mergeJobImportParseProgress(importId, {
      phase: 'document_ai',
      startedAt: new Date().toISOString(),
    });

    const extraction = await extractTextFromPdfWithDocumentAi(Buffer.from(jobImport.sourceFileBytes));
    await mergeJobImportParseProgress(importId, {
      phase: 'document_ai',
      pageCount: extraction.pageCount,
    });

    const sourceFileHash = computeFileHash(Buffer.from(jobImport.sourceFileBytes));

    const deterministicResult = parseTfMaterialPicksheet(extraction.pages);
    const allSorted = extraction.pages.map((p) => p.pageNumber).sort((a, b) => a - b);

    await mergeJobImportParseProgress(importId, {
      phase: 'header_llm',
      totalTextChunks: 0,
    });

    const headerPages = allSorted.slice(0, Math.min(3, allSorted.length));
    const headerResponse = await parseHeaderWithOpenAi(extraction.pages, headerPages);

    let isHeaderStub =
      shouldUseHeaderStubImportPath(extraction.layoutProfile, deterministicResult.lineItems.length) ||
      shouldUseHeaderStubLlmFallback(
        extraction.pageCount,
        extraction.layoutProfile,
        deterministicResult.lineItems.length,
        headerResponse,
        jobImport.sourceFileName,
      );
    const importIntent: JobImportIntent = isHeaderStub ? 'header_stub' : 'full';

    let pageChunks: number[][] = [];
    if (!isHeaderStub) {
      const orderedMaterial = buildOrderedMaterialPages(allSorted, deterministicResult.materialPageNumbers);
      const measureChars = (nums: number[]) => buildPageOcrContext(extraction.pages, nums).length;
      const greedy = buildGreedyPageChunks(orderedMaterial, getChunkMaxInputChars(), measureChars);
      pageChunks = addOnePageOverlapBetweenChunks(greedy);
    }

    await mergeJobImportParseProgress(importId, {
      phase: 'header_llm',
      totalTextChunks: pageChunks.length,
    });

    let mergedLines: RawAiLineItem[] = [];
    let mergedVisionLineItems: ImportParsedLineItem[] = [];
    let mergedVisionMeta: NonNullable<JobImportReviewSnapshot['visionMetadata']> = {
      renderedPages: [],
      imageCount: 0,
      dpi: 180,
      imageWidth: null,
      imageHeight: null,
      model: null,
    };

    if (!isHeaderStub) {
      await mergeJobImportParseProgress(importId, {
        phase: 'line_chunks',
        totalTextChunks: pageChunks.length,
        completedTextChunks: 0,
      });

      const textChunkResults = await runBoundedPool(pageChunks, getChunkConcurrency(), async (chunkPages, index) => {
        const [lo, hi] = chunkPageRangeLabel(chunkPages);
        await mergeJobImportParseProgress(importId, {
          phase: 'line_chunks',
          totalTextChunks: pageChunks.length,
          completedTextChunks: index,
          current: {
            textChunk: index + 1,
            pageRange: [lo, hi],
            label: `Parsing pages ${lo}-${hi} (text ${index + 1}/${pageChunks.length})`,
          },
        });
        return parseLineItemsForPagesWithSplits(chunkPages, extraction.pages, 0);
      });

      await mergeJobImportParseProgress(importId, {
        phase: 'line_chunks',
        completedTextChunks: pageChunks.length,
        current: undefined,
      });

      mergedLines = dedupeAdjacentRawLineItems(textChunkResults.flat());

      await mergeJobImportParseProgress(importId, {
        phase: 'vision_chunks',
        totalTextChunks: pageChunks.length,
        completedTextChunks: 0,
      });

      const openai = getOpenAiClient();
      const uploadedFileId = await uploadPdfForVisionVerification(
        openai,
        Buffer.from(jobImport.sourceFileBytes),
        jobImport.sourceFileName,
      );
      try {
        const visionChunkResults = await runBoundedPool(
          pageChunks,
          getChunkConcurrency(),
          async (chunkPages, index) => {
            const [lo, hi] = chunkPageRangeLabel(chunkPages);
            await mergeJobImportParseProgress(importId, {
              phase: 'vision_chunks',
              totalTextChunks: pageChunks.length,
              completedTextChunks: index,
              current: {
                visionChunk: index + 1,
                pageRange: [lo, hi],
                label: `Verifying pages ${lo}-${hi} (vision ${index + 1}/${pageChunks.length})`,
              },
            });
            return visionLineItemsForChunkPagesHard({
              openai,
              uploadedFileId,
              rawText: extraction.text,
              pages: extraction.pages,
              sourceFileName: jobImport.sourceFileName,
              chunkPageNums: chunkPages,
            });
          },
        );
        mergedVisionLineItems = visionChunkResults.flatMap((r) => r.lineItems);
        mergedVisionMeta = mergeVisionMetadataChunks(visionChunkResults);
      } finally {
        try {
          await openai.files.delete(uploadedFileId);
        } catch (cleanupError) {
          console.warn('Job import vision source file cleanup failed.', {
            fileId: uploadedFileId,
            message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    } else {
      await mergeJobImportParseProgress(importId, {
        phase: 'line_chunks',
        totalTextChunks: 0,
        completedTextChunks: 0,
        current: {
          label: 'Skipped — no material table rows on picksheet (header-only path)',
        },
      });
      await mergeJobImportParseProgress(importId, {
        phase: 'vision_chunks',
        totalTextChunks: 0,
        completedTextChunks: 0,
        current: undefined,
      });
    }

    const rawResponse: RawAiResponse = {
      ...headerResponse,
      lineItems: mergedLines,
    };

    await mergeJobImportParseProgress(importId, {
      phase: 'merge',
      current: { label: 'Building review snapshot…' },
    });

    const initialWarnings: ImportWarning[] = deterministicResult.issues.map((issue) => {
      const downgradeForStub =
        isHeaderStub &&
        (issue.code === 'unsupported_format' || issue.code === 'missing_column_anchors') &&
        issue.severity === 'error';
      return {
        code: issue.code,
        severity: downgradeForStub ? 'warning' : issue.severity,
        message: issue.message,
        lineItemId: issue.lineItemId || null,
      };
    });

    const reviewSnapshot = await buildReviewSnapshot({
      importId,
      rawResponse,
      existingSnapshot: coerceReviewSnapshot(jobImport.reviewSnapshot) || undefined,
      sourceFileName: jobImport.sourceFileName,
      sourceFileHash,
      createdBy: jobImport.createdBy,
      rawText: extraction.text,
      importedAt: toDateKeyInAppTimeZone(new Date()),
      mode: toJobImportMode(jobImport.mode),
      layoutProfile: extraction.layoutProfile,
      formatTrusted: extraction.layoutProfile === 'tf_material_picksheet_v1' && deterministicResult.formatTrusted,
      initialWarnings,
      deterministicLineItems: deterministicResult.lineItems,
      secondaryLineItems: mergedVisionLineItems,
      visionMetadata: mergedVisionMeta,
      targetJobNumber: jobImport.targetJobNumber,
      targetListNumber: jobImport.targetListNumber,
      targetJobName: jobImport.targetJobName,
      importIntent,
    });

    return await updateJobImportRecord(importId, {
      status: 'READY',
      importIntent,
      rawText: extraction.text,
      ocrMetadata: {
        pageCount: extraction.pageCount,
        mimeType: extraction.mimeType,
        processorLocation: process.env.GOOGLE_DOCUMENT_AI_LOCATION || null,
        layoutProfile: extraction.layoutProfile,
        pages: extraction.pages,
        sourceFileHash,
        visionMetadata: mergedVisionMeta,
      } as unknown as Prisma.InputJsonValue,
      parsedSnapshot: rawResponse as unknown as Prisma.InputJsonValue,
      reviewSnapshot: reviewSnapshot as unknown as Prisma.InputJsonValue,
      warningSummary: countWarnings(reviewSnapshot.warnings) as unknown as Prisma.InputJsonValue,
      duplicateSnapshot: (reviewSnapshot.duplicateInfo || null) as unknown as Prisma.InputJsonValue,
      errorMessage: null,
    });
  } catch (error) {
    return await updateJobImportRecord(importId, {
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : 'Failed to parse import.',
    });
  }
}

export async function getJobImport(importId: string): Promise<JobImportRecordResponse> {
  const jobImport = await prismaAny.jobImport.findUnique({ where: { id: importId } });
  if (!jobImport) throw new Error('Import session not found.');
  return serializeJobImport(jobImport);
}

export async function saveJobImportReview(
  importId: string,
  input: SaveReviewInput,
): Promise<JobImportRecordResponse> {
  const jobImport = await prismaAny.jobImport.findUnique({ where: { id: importId } });
  if (!jobImport) throw new Error('Import session not found.');

  const rebuiltSnapshot = await buildReviewSnapshot({
    importId,
    rawResponse: coerceJsonObject(jobImport.parsedSnapshot) as RawAiResponse | null,
    existingSnapshot: input.reviewSnapshot,
    sourceFileName: jobImport.sourceFileName,
    sourceFileHash:
      typeof coerceJsonObject(jobImport.ocrMetadata)?.sourceFileHash === 'string'
        ? normalizeText(coerceJsonObject(jobImport.ocrMetadata)?.sourceFileHash as string) || null
        : null,
    createdBy: jobImport.createdBy,
    rawText: jobImport.rawText || '',
    importedAt: input.reviewSnapshot.importedAt || toDateKeyInAppTimeZone(new Date()),
    mode: toJobImportMode(jobImport.mode),
    layoutProfile:
      (coerceJsonObject(jobImport.ocrMetadata)?.layoutProfile as JobImportReviewSnapshot['layoutProfile'] | undefined) ||
      input.reviewSnapshot.layoutProfile,
    formatTrusted:
      typeof input.reviewSnapshot.formatTrusted === 'boolean'
        ? input.reviewSnapshot.formatTrusted
        : (coerceJsonObject(jobImport.ocrMetadata)?.layoutProfile as string | undefined) === 'tf_material_picksheet_v1',
    targetJobNumber: jobImport.targetJobNumber,
    targetListNumber: jobImport.targetListNumber,
    targetJobName: jobImport.targetJobName,
    importIntent: normalizeJobImportIntent(jobImport.importIntent),
  });

  const updated = await updateJobImportRecord(importId, {
    status: 'READY',
    targetListNumber: normalizeOptionalText(rebuiltSnapshot.targetContext?.listNumber) || jobImport.targetListNumber,
    reviewSnapshot: rebuiltSnapshot as unknown as Prisma.InputJsonValue,
    ...(input.draftState
      ? {
          draftState: {
            ...normalizeJobImportDraftState(input.draftState),
            lastAutosavedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        }
      : {}),
    warningSummary: countWarnings(rebuiltSnapshot.warnings) as unknown as Prisma.InputJsonValue,
    duplicateSnapshot: (rebuiltSnapshot.duplicateInfo || null) as unknown as Prisma.InputJsonValue,
    errorMessage: null,
  });

  return serializeJobImport(updated);
}

export async function reparseJobImport(importId: string): Promise<JobImportRecordResponse> {
  await updateJobImportRecord(importId, {
    status: 'PROCESSING',
    errorMessage: null,
  });
  const parsed = await parseJobImport(importId);
  return serializeJobImport(parsed);
}

export async function commitJobImport(
  importId: string,
  input: CommitJobImportInput,
  actor: CommitJobImportActor,
): Promise<{
  committedJobNumber: string;
  committedListNumber: string;
  initialNoteId: string | null;
}> {
  const jobImport = await prismaAny.jobImport.findUnique({ where: { id: importId } });
  if (!jobImport) throw new Error('Import session not found.');
  const mode = toJobImportMode(jobImport.mode);

  const normalizedRecord = await saveJobImportReview(importId, { reviewSnapshot: input.reviewSnapshot });
  const reviewSnapshot = normalizedRecord.reviewSnapshot;
  if (!reviewSnapshot) throw new Error('Review snapshot is missing.');
  if (reviewSnapshot.missingRequiredFields.length > 0) {
    throw new Error('Required fields must be completed before committing this import.');
  }
  if (!reviewSnapshot.formatTrusted) {
    throw new Error('This PDF format was not trusted enough to commit automatically.');
  }
  if ((reviewSnapshot.blockingIssues || []).length > 0) {
    throw new Error('Resolve the blocking import errors before committing this PDF.');
  }

  const targetContext = reviewSnapshot.targetContext;
  const existingUpdateTargetJobNumber =
    normalizeText(targetContext?.jobNumber) || normalizeText(jobImport.targetJobNumber);
  const existingUpdateTargetListNumber =
    normalizeText(targetContext?.listNumber) || normalizeText(jobImport.targetListNumber);
  const existingUpdateTargetJobName =
    normalizeText(targetContext?.jobName) || normalizeText(jobImport.targetJobName);

  if (
    mode === 'existing_job_update' &&
    targetContext?.requiresListSelection &&
    !targetContext.listSelectionConfirmed
  ) {
    throw new Error('Choose the target list before committing this PDF update.');
  }

  const jobNumber =
    mode === 'existing_job_update'
      ? existingUpdateTargetJobNumber
      : normalizeText(reviewSnapshot.jobInfo.jobNumber);
  const jobName =
    mode === 'existing_job_update'
      ? existingUpdateTargetJobName
      : normalizeText(reviewSnapshot.jobInfo.jobName);
  const listNumber =
    mode === 'existing_job_update'
      ? existingUpdateTargetListNumber
      : normalizeText(reviewSnapshot.jobInfo.listNumber) || (await getNextListNumber(jobNumber));
  const deliveryDate = parseDateInputInAppTimeZone(reviewSnapshot.jobInfo.deliveryDate);
  const stocklistDate = parseDateInputInAppTimeZone(reviewSnapshot.jobInfo.stocklistDeliveryShipDate);

  if (!jobNumber || !jobName || !listNumber || !deliveryDate) {
    throw new Error('jobNumber, jobName, listNumber, and deliveryDate are required before commit.');
  }

  validateCommitLineItemQuantities(reviewSnapshot.lineItems);

  const savedDraftState = normalizeJobImportDraftState(jobImport.draftState);
  const accessGrantsInput =
    input.accessGrants !== undefined && input.accessGrants !== null
      ? input.accessGrants
      : savedDraftState.accessGrants;
  const resolvedAccessGrants = await resolveInitialAccessGrantsFromBody(
    accessGrantsInput,
    actor.email || null,
  );

  const existingJob = await prisma.job.findFirst({
    where: {
      jobNumber,
      listNumber,
    },
  });

  const perPartDecisions: Record<string, ImportDuplicateAction> = {};
  const perPartCustomQuantities: Record<string, number> = {};

  for (const decision of reviewSnapshot.duplicateDecisions) {
    perPartDecisions[decision.partNumber] = decision.action;
    if (decision.action === 'custom' && typeof decision.customQuantity === 'number') {
      perPartCustomQuantities[decision.partNumber] = Math.max(0, Math.round(decision.customQuantity));
    }
  }

  if (mode === 'existing_job_update') {
    await updateExistingJobMetadata({
      jobNumber,
      listNumber,
      area: normalizeOptionalText(reviewSnapshot.jobInfo.area),
      locationShipTo: normalizeOptionalText(reviewSnapshot.jobInfo.locationShipTo),
      stocklistDeliveryShipDate: reviewSnapshot.jobInfo.stocklistDeliveryShipDate || null,
      listedBy: normalizeOptionalText(reviewSnapshot.jobInfo.listedBy),
      deliveryDate: reviewSnapshot.jobInfo.deliveryDate || null,
    });
  }

  const result = await createJobWithMerge({
    jobNumber,
    jobName,
    listNumber,
    area: normalizeOptionalText(reviewSnapshot.jobInfo.area),
    locationShipTo: normalizeOptionalText(reviewSnapshot.jobInfo.locationShipTo),
    stocklistDeliveryShipDate: stocklistDate,
    listedBy: normalizeOptionalText(reviewSnapshot.jobInfo.listedBy),
    pulledBy: actor.name?.trim() || actor.email,
    deliveryDate,
    lineItems: sortLineItemsByRowOrder(reviewSnapshot.lineItems).map((item) => ({
      partNumber: item.partNumber,
      quantityNeeded: item.quantityNeeded,
      quantityFab: item.quantityFab,
      description: item.description,
      unitOfMeasurement: item.unitOfMeasurement,
      type: item.type,
    })),
    duplicateAction: 'replace',
    perPartDecisions: Object.keys(perPartDecisions).length > 0 ? perPartDecisions : undefined,
    perPartCustomQuantities:
      Object.keys(perPartCustomQuantities).length > 0 ? perPartCustomQuantities : undefined,
    creatorTimezone: APP_TIME_ZONE,
  });

  if (actor.email) {
    await grantCreatorJobAccess(jobNumber, actor.email, listNumber);
  }

  await applyResolvedInitialAccessGrants({
    jobNumber,
    listNumber,
    creatorEmail: actor.email || null,
    grants: resolvedAccessGrants,
    grantedByEmail: actor.email || '',
    grantedByRole: actor.role ?? undefined,
  });

  const draftAttachments = await prismaAny.jobImportDraftAttachment.findMany({
    where: { jobImportId: importId },
    orderBy: { createdAt: 'asc' },
  });
  const initialNoteText =
    normalizeOptionalText(input.initialNote?.content) ??
    normalizeOptionalText(reviewSnapshot.workspaceNote);
  const initialNoteHasAttachments =
    input.initialNote?.hasAttachments === true || draftAttachments.length > 0;
  const noteListNumber = normalizeListContextForLookup(listNumber);
  const createdByDisplay = actor.name?.trim() || actor.email || null;
  let initialNote:
    | {
        id: string;
        content: string;
        createdAt: Date;
      }
    | null = null;

  if (initialNoteText || initialNoteHasAttachments) {
    try {
      const note = await prisma.jobNote.create({
        data: {
          jobNumber,
          listNumber: noteListNumber,
          content: initialNoteText ?? '',
          createdBy: createdByDisplay,
        },
      });
      initialNote = {
        id: note.id,
        content: note.content,
        createdAt: note.createdAt,
      };

      if (draftAttachments.length > 0) {
        await prismaAny.jobNoteAttachment.createMany({
          data: draftAttachments.map((attachment: any) => ({
            noteId: note.id,
            jobNumber,
            listNumber: noteListNumber,
            r2Key: attachment.r2Key,
            contentType: attachment.contentType,
            sizeBytes: attachment.sizeBytes,
            width: attachment.width,
            height: attachment.height,
            fileName: attachment.fileName,
            createdBy: createdByDisplay,
          })),
          skipDuplicates: true,
        });
      }

      if (existingJob || mode !== 'new_job_import') {
        await sendNoteAddedNotification(
          jobNumber,
          noteListNumber,
          note.id,
          note.content,
          createdByDisplay,
          actor.email || null,
          false,
        ).catch((notifErr) => {
          console.error('Error sending note-added notification from import commit:', notifErr);
        });
      }
    } catch (noteErr) {
      console.error('Error creating job note from import workspace:', noteErr);
    }
  }

  cache.delete(cacheKeys.jobsList());
  cache.delete(cacheKeys.calendar());
  cache.delete(cacheKeys.jobDetails(jobNumber, listNumber));

  if (!existingJob && mode === 'new_job_import') {
    await sendJobCreatedNotification(jobNumber, actor.email, actor.name || actor.email, {
      jobName: result.jobName,
      listNumber,
      deliveryDate,
      area: normalizeOptionalText(reviewSnapshot.jobInfo.area),
      locationShipTo: normalizeOptionalText(reviewSnapshot.jobInfo.locationShipTo),
      listedBy: normalizeOptionalText(reviewSnapshot.jobInfo.listedBy),
      contractNumber: null,
      stocklistDeliveryShipDate: stocklistDate,
      initialNote: initialNote
        ? {
            noteId: initialNote.id,
            content: initialNote.content,
            createdBy: createdByDisplay,
            createdByEmail: actor.email || null,
            createdAt: initialNote.createdAt,
            hasAttachments: initialNoteHasAttachments,
          }
        : null,
      lineItems: result.lineItems.map((item) => ({
        partNumber: item.partNumber ?? '',
        description: item.description ?? null,
        quantityNeeded: item.quantityNeeded ?? 0,
        uom: item.uom ?? null,
        type: item.type ?? null,
      })),
    }).catch((error) => {
      console.error('Error sending job-created notification from import commit:', error);
    });

    await autoAddEligibleUsersToJob({
      jobNumber,
      listNumber,
      isServiceJob: false,
    });
  }

  await prismaAny.jobImport.update({
    where: { id: importId },
    data: {
      status: 'COMMITTED',
      committedBy: actor.email || null,
      committedAt: new Date(),
      committedJobNumber: jobNumber,
      committedListNumber: listNumber,
      commitSummary: {
        mode,
        lineItemCount: result.lineItems.length,
      },
    },
  });

  return {
    committedJobNumber: jobNumber,
    committedListNumber: listNumber,
    initialNoteId: initialNote?.id ?? null,
  };
}

export async function listJobImports(params: {
  mode?: JobImportMode;
  targetJobNumber?: string;
  targetListNumber?: string | null;
  statuses?: JobImportRecordResponse['status'][];
  createdBy?: string | null;
}): Promise<JobImportRecordResponse[]> {
  const normalizedJobNumber = params.targetJobNumber ? params.targetJobNumber.trim() : null;
  const normalizedListNumber = params.targetListNumber ? normalizeListNumber(params.targetListNumber) : null;

  const andConditions: Prisma.JobImportWhereInput[] = [];
  if (params.mode) {
    andConditions.push({ mode: params.mode === 'existing_job_update' ? 'EXISTING_JOB_UPDATE' : 'NEW_JOB_IMPORT' });
  }
  if (normalizedJobNumber) {
    andConditions.push({
      OR: [{ targetJobNumber: normalizedJobNumber }, { committedJobNumber: normalizedJobNumber }],
    });
  }
  if (normalizedListNumber) {
    andConditions.push({
      OR: [{ targetListNumber: normalizedListNumber }, { committedListNumber: normalizedListNumber }],
    });
  }
  if (params.statuses && params.statuses.length > 0) {
    andConditions.push({ status: { in: params.statuses } });
  }
  if (params.createdBy) {
    andConditions.push({ createdBy: normalizeText(params.createdBy).toLowerCase() });
  }

  const imports = await prismaAny.jobImport.findMany({
    where: andConditions.length > 0 ? { AND: andConditions } : {},
    orderBy: { createdAt: 'desc' },
  });

  return imports.map((jobImport: JobImport) => serializeJobImport(jobImport));
}

export async function listJobImportSummaries(params: {
  mode?: JobImportMode;
  targetJobNumber?: string;
  targetListNumber?: string | null;
  statuses?: JobImportListStatus[];
  createdBy?: string | null;
  take?: number;
  cursor?: string | null;
}): Promise<JobImportListPage> {
  const take = Math.min(Math.max(Math.trunc(params.take ?? 12), 1), 50);
  const baseWhere = {
      ...(params.mode
        ? { mode: params.mode === 'existing_job_update' ? 'EXISTING_JOB_UPDATE' : 'NEW_JOB_IMPORT' }
        : {}),
      ...(params.targetJobNumber ? { targetJobNumber: params.targetJobNumber.trim() } : {}),
      ...(params.targetListNumber ? { targetListNumber: normalizeListNumber(params.targetListNumber) } : {}),
      ...(params.createdBy ? { createdBy: normalizeText(params.createdBy).toLowerCase() } : {}),
    };
  const activeStatuses: JobImportListStatus[] = ['PROCESSING', 'READY', 'FAILED'];
  const listWhere = {
    ...baseWhere,
    status: { in: params.statuses && params.statuses.length > 0 ? params.statuses : activeStatuses },
  };

  const [imports, processing, ready, failed] = await Promise.all([
    prismaAny.jobImport.findMany({
      where: listWhere,
    select: {
      id: true,
      status: true,
      sourceFileName: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      errorMessage: true,
      draftState: true,
      reviewSnapshot: true,
    },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      take: take + 1,
    }),
    prismaAny.jobImport.count({ where: { ...baseWhere, status: 'PROCESSING' } }),
    prismaAny.jobImport.count({ where: { ...baseWhere, status: 'READY' } }),
    prismaAny.jobImport.count({ where: { ...baseWhere, status: 'FAILED' } }),
  ]);

  const pageRows = imports.slice(0, take);
  const hasMore = imports.length > take;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null;

  return {
    imports: pageRows.map((jobImport: any) => ({
    id: jobImport.id,
    status: jobImport.status as JobImportRecordResponse['status'],
    sourceFileName: jobImport.sourceFileName,
    createdBy: jobImport.createdBy,
    createdAt: jobImport.createdAt.toISOString(),
    updatedAt: jobImport.updatedAt.toISOString(),
    errorMessage: jobImport.errorMessage || null,
    draftState: normalizeJobImportDraftState(jobImport.draftState),
    jobInfo: extractJobInfoSummary(jobImport.reviewSnapshot),
    })),
    counts: {
      all: processing + ready + failed,
      processing,
      ready,
      failed,
    },
    nextCursor,
    hasMore,
  };
}

export async function discardJobImportDraft(importId: string): Promise<JobImportRecordResponse> {
  const jobImport = await prismaAny.jobImport.findUnique({
    where: { id: importId },
    include: { draftAttachments: true },
  });
  if (!jobImport) throw new Error('Import session not found.');
  if (jobImport.status === 'COMMITTED') {
    throw new Error('Committed imports cannot be discarded.');
  }
  if (toJobImportMode(jobImport.mode) !== 'new_job_import') {
    throw new Error('Only new job import drafts can be discarded here.');
  }

  for (const attachment of jobImport.draftAttachments || []) {
    if (!attachment.r2Key) continue;
    try {
      await deleteR2Object({ key: attachment.r2Key });
    } catch (error) {
      console.error('Failed to delete import draft attachment while discarding draft:', error);
    }
  }

  await prismaAny.jobImport.delete({ where: { id: importId } });
  return serializeJobImport(jobImport);
}

export function jobImportBelongsToJobList(
  jobImport: Pick<
    JobImportRecordResponse,
    'targetJobNumber' | 'committedJobNumber' | 'targetListNumber' | 'committedListNumber'
  >,
  jobNumber: string,
  listNumber?: string | null,
): boolean {
  const normalizedJobNumber = jobNumber.trim();
  if (!normalizedJobNumber) return false;

  const targetJobNumber = (jobImport.targetJobNumber || '').trim();
  const committedJobNumber = (jobImport.committedJobNumber || '').trim();
  const matchesJob =
    targetJobNumber === normalizedJobNumber || committedJobNumber === normalizedJobNumber;
  if (!matchesJob) return false;

  if (!listNumber || listNumber.trim() === '' || listNumber.trim() === LIST_CONTEXT_ALL) {
    return true;
  }

  const normalizedListNumber = normalizeListNumber(listNumber);
  const targetListNumber = jobImport.targetListNumber
    ? normalizeListNumber(jobImport.targetListNumber)
    : null;
  const committedListNumber = jobImport.committedListNumber
    ? normalizeListNumber(jobImport.committedListNumber)
    : null;

  return (
    targetListNumber === normalizedListNumber || committedListNumber === normalizedListNumber
  );
}

export async function getJobImportSource(importId: string): Promise<{
  fileName: string;
  contentType: string;
  fileBytes: Buffer;
}> {
  const jobImport = await prismaAny.jobImport.findUnique({
    where: { id: importId },
    select: {
      sourceFileName: true,
      sourceContentType: true,
      sourceFileBytes: true,
    },
  });

  if (!jobImport?.sourceFileBytes) {
    throw new Error('Import source file not found.');
  }

  return {
    fileName: jobImport.sourceFileName,
    contentType: jobImport.sourceContentType || 'application/pdf',
    fileBytes: Buffer.from(jobImport.sourceFileBytes),
  };
}
