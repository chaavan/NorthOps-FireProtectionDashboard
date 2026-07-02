import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EstimateCatalogRow, EstimateDraft } from "@/lib/estimateTypes";
import { computeEstimateFromDraft } from "@/lib/estimate/estimateEngine";
import {
  buildMaterialCatalogRowMetadata,
  createDefaultEstimateDraft,
  SYSTEM1_TEMPLATE_KEY,
} from "@/lib/estimate/system1Template";

export type MaterialCatalogRowPatch = {
  label?: string | null;
  description?: string | null;
  detail?: string | null;
  section?: string | null;
  subcategory?: string | null;
  defaultUnitCost?: number | null;
};

export type MaterialCatalogEditLogRecord = {
  id: string;
  rowKey: string;
  actorEmail: string | null;
  changedFields: string[];
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  createdAt: string;
};

type OverrideRecord = {
  row_key: string;
  data: Prisma.JsonValue;
};

type LogRecord = {
  id: string;
  row_key: string;
  actor_email: string | null;
  changed_fields: Prisma.JsonValue;
  before_data: Prisma.JsonValue;
  after_data: Prisma.JsonValue;
  created_at: Date;
};

const EDITABLE_FIELDS = [
  "label",
  "description",
  "detail",
  "section",
  "subcategory",
  "defaultUnitCost",
] as const;

const FORCED_CATALOG_PATHS = [
  { start: 337, end: 421, section: "Pipe", subcategory: "General" },
  { start: 709, end: 774, section: "Backflow Devices", subcategory: "General" },
  { start: 776, end: 903, section: "Hose Equipment", subcategory: "General" },
  { start: 904, end: 963, section: "Misc. & Devices", subcategory: "General" },
  { start: 976, end: 1154, section: "CPVC", subcategory: "General" },
] as const;

function normalizeNullableText(value: unknown) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSectionText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeUnitCost(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function normalizePatch(patch: MaterialCatalogRowPatch, baseRow: EstimateCatalogRow) {
  const normalized: MaterialCatalogRowPatch = {};
  if ("label" in patch) normalized.label = normalizeNullableText(patch.label);
  if ("description" in patch) normalized.description = normalizeNullableText(patch.description);
  if ("detail" in patch) normalized.detail = normalizeNullableText(patch.detail);
  if ("section" in patch) normalized.section = normalizeSectionText(patch.section);
  if ("subcategory" in patch) normalized.subcategory = normalizeNullableText(patch.subcategory);
  if ("defaultUnitCost" in patch && !baseRow.formulaKey) {
    normalized.defaultUnitCost = normalizeUnitCost(patch.defaultUnitCost);
  }
  return normalized;
}

function rowEditableSnapshot(row: EstimateCatalogRow): MaterialCatalogRowPatch {
  return {
    label: row.label,
    description: row.description,
    detail: row.detail,
    section: row.section,
    subcategory: row.subcategory,
    defaultUnitCost: row.defaultUnitCost,
  };
}

function valuesEqual(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function changedFields(beforeData: MaterialCatalogRowPatch, afterData: MaterialCatalogRowPatch) {
  return EDITABLE_FIELDS.filter((field) => !valuesEqual(beforeData[field], afterData[field]));
}

function applyPatchToRow(row: EstimateCatalogRow, patch: MaterialCatalogRowPatch): EstimateCatalogRow {
  const next = {
    ...row,
    ...patch,
    section: patch.section ?? row.section,
  };
  if (row.formulaKey) {
    next.defaultUnitCost = row.defaultUnitCost;
  }
  return applyCatalogPathRules(next);
}

function applyCatalogPathRules(row: EstimateCatalogRow): EstimateCatalogRow {
  if (!row.section?.trim()) {
    return row;
  }
  const forcedPath = FORCED_CATALOG_PATHS.find(
    (path) => row.sheetRow >= path.start && row.sheetRow <= path.end,
  );
  if (forcedPath) {
    return {
      ...row,
      section: forcedPath.section,
      subcategory: forcedPath.subcategory,
    };
  }
  return row;
}

function overrideDataForRow(row: EstimateCatalogRow) {
  const data = rowEditableSnapshot(row);
  if (row.formulaKey) {
    delete data.defaultUnitCost;
  }
  return data;
}

function rowsByKey(rows: EstimateCatalogRow[]) {
  return new Map(rows.map((row) => [row.rowKey, row]));
}

function catalogPartName(row: EstimateCatalogRow) {
  return [row.label, row.description].filter(Boolean).join(" ") || `Row ${row.sheetRow}`;
}

function catalogPartDescription(row: EstimateCatalogRow) {
  return row.detail || row.description || row.label || "";
}

async function loadOverrideMap() {
  const records = await prisma.$queryRaw<OverrideRecord[]>`
    SELECT row_key, data
    FROM system1_material_catalog_overrides
  `;
  return new Map(
    records.map((record) => [
      record.row_key,
      (record.data && typeof record.data === "object" ? record.data : {}) as MaterialCatalogRowPatch,
    ]),
  );
}

export async function listMaterialCatalogRows(): Promise<EstimateCatalogRow[]> {
  const baseRows = buildMaterialCatalogRowMetadata();
  const overrides = await loadOverrideMap();
  const rows = baseRows.map((row) => {
    const override = overrides.get(row.rowKey);
    return override ? applyPatchToRow(row, normalizePatch(override, row)) : applyCatalogPathRules(row);
  });
  const cellOverrides = buildCatalogUnitCostCellOverrides(rows, baseRows);
  const draft = createDefaultEstimateDraft({
    jobNumber: "MATERIAL-CATALOG",
    jobName: "Material Catalog",
    lineItems: [],
    jobMeta: {
      listNumber: "Catalog",
      area: null,
      locationShipTo: null,
      stocklistDeliveryShipDate: null,
      listedBy: null,
      listedByName: null,
    },
  });
  const computed = computeEstimateFromDraft({
    ...draft,
    materials: {
      ...draft.materials,
      workbookCatalog: {
        rows,
        cellOverrides,
      },
    },
  });
  return computed.materials;
}

function buildCatalogUnitCostCellOverrides(rows: EstimateCatalogRow[], baseRows: EstimateCatalogRow[]) {
  const baseByKey = rowsByKey(baseRows);
  const cellOverrides: Record<string, number> = {};
  rows.forEach((row) => {
    const base = baseByKey.get(row.rowKey);
    if (
      base &&
      !row.formulaKey &&
      row.unitCostCell &&
      typeof row.defaultUnitCost === "number" &&
      !valuesEqual(base.defaultUnitCost, row.defaultUnitCost)
    ) {
      cellOverrides[row.unitCostCell.toUpperCase()] = row.defaultUnitCost;
    }
  });
  return cellOverrides;
}

export async function applyMaterialCatalogDefaultsToDraft(draft: EstimateDraft): Promise<EstimateDraft> {
  const rows = await listMaterialCatalogRows();
  const cellOverrides = {
    ...(draft.materials?.workbookCatalog?.cellOverrides ?? {}),
    ...buildCatalogUnitCostCellOverrides(rows, buildMaterialCatalogRowMetadata()),
  };

  return {
    ...draft,
    materials: {
      ...draft.materials,
      workbookCatalog: {
        rows,
        cellOverrides,
      },
    },
  };
}

export function validateMaterialCatalogPassword(password: unknown) {
  const configured = process.env.MATERIAL_CATALOG_EDIT_PASSWORD;
  if (!configured) {
    return { ok: false as const, error: "Material catalog edit password is not configured." };
  }
  if (String(password ?? "") !== configured) {
    return { ok: false as const, error: "Invalid material catalog edit password." };
  }
  return { ok: true as const };
}

async function patchEstimateCatalogRow(params: {
  estimateId: string;
  variantKey: string | null;
  row: EstimateCatalogRow;
  actorEmail: string | null;
}) {
  const variantKey = params.variantKey?.trim() || "base";
  const variant = await prisma.standaloneEstimateVariant.findFirst({
    where: {
      estimateId: params.estimateId,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      variantKey,
    },
  });
  if (!variant) return null;

  const draft = variant.data as EstimateDraft;
  const currentRows = draft.materials?.workbookCatalog?.rows?.length
    ? draft.materials.workbookCatalog.rows
    : buildMaterialCatalogRowMetadata();
  const nextRows = currentRows.map((row) => (row.rowKey === params.row.rowKey ? params.row : row));
  const nextVisibleLines = (draft.materials?.visibleLines ?? []).map((line) =>
    line.catalogRowKey === params.row.rowKey
      ? {
          ...line,
          partNumber: catalogPartName(params.row),
          description: catalogPartDescription(params.row),
        }
      : line,
  );
  const nextCellOverrides = { ...(draft.materials?.workbookCatalog?.cellOverrides ?? {}) };
  if (!params.row.formulaKey && params.row.unitCostCell && typeof params.row.defaultUnitCost === "number") {
    nextCellOverrides[params.row.unitCostCell.toUpperCase()] = params.row.defaultUnitCost;
  }
  const nextDraft: EstimateDraft = {
    ...draft,
    materials: {
      ...draft.materials,
      visibleLines: nextVisibleLines,
      workbookCatalog: {
        rows: nextRows,
        cellOverrides: nextCellOverrides,
      },
    },
  };
  const computed = computeEstimateFromDraft(nextDraft);
  await prisma.standaloneEstimateVariant.update({
    where: { id: variant.id },
    data: {
      data: computed.draft as unknown as Prisma.InputJsonValue,
      subtotal: computed.summary.subtotal,
      totalCost: computed.summary.totalCost,
      updatedBy: params.actorEmail,
    },
  });
  return computed;
}

export async function saveMaterialCatalogRowEdit(params: {
  rowKey: string;
  patch: MaterialCatalogRowPatch;
  actorEmail: string | null;
  estimateId?: string | null;
  variantKey?: string | null;
}) {
  const baseRows = buildMaterialCatalogRowMetadata();
  const baseByKey = rowsByKey(baseRows);
  const baseRow = baseByKey.get(params.rowKey);
  if (!baseRow) {
    throw new Error("Catalog row not found.");
  }

  const currentRows = await listMaterialCatalogRows();
  const currentRow = rowsByKey(currentRows).get(params.rowKey) ?? baseRow;
  const normalizedPatch = normalizePatch(params.patch, baseRow);
  const nextRow = applyPatchToRow(currentRow, normalizedPatch);
  const beforeData = rowEditableSnapshot(currentRow);
  const afterData = rowEditableSnapshot(nextRow);
  const fields = changedFields(beforeData, afterData);

  if (fields.length === 0) {
    return {
      row: currentRow,
      changedFields: [],
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO system1_material_catalog_overrides (row_key, data, created_by, updated_by, created_at, updated_at)
      VALUES (
        ${params.rowKey},
        ${JSON.stringify(overrideDataForRow(nextRow))}::jsonb,
        ${params.actorEmail},
        ${params.actorEmail},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (row_key) DO UPDATE SET
        data = EXCLUDED.data,
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `;
    await tx.$executeRaw`
      INSERT INTO system1_material_catalog_edit_logs (
        id,
        row_key,
        actor_email,
        changed_fields,
        before_data,
        after_data,
        created_at
      )
      VALUES (
        ${crypto.randomUUID()},
        ${params.rowKey},
        ${params.actorEmail},
        ${JSON.stringify(fields)}::jsonb,
        ${JSON.stringify(beforeData)}::jsonb,
        ${JSON.stringify(afterData)}::jsonb,
        CURRENT_TIMESTAMP
      )
    `;
  });

  if (params.estimateId) {
    await patchEstimateCatalogRow({
      estimateId: params.estimateId,
      variantKey: params.variantKey ?? null,
      row: nextRow,
      actorEmail: params.actorEmail,
    });
  }

  return {
    row: nextRow,
    changedFields: fields,
  };
}

export async function listMaterialCatalogEditLogs(limit = 100): Promise<MaterialCatalogEditLogRecord[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 250);
  const records = await prisma.$queryRaw<LogRecord[]>`
    SELECT id, row_key, actor_email, changed_fields, before_data, after_data, created_at
    FROM system1_material_catalog_edit_logs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return records.map((record) => ({
    id: record.id,
    rowKey: record.row_key,
    actorEmail: record.actor_email,
    changedFields: Array.isArray(record.changed_fields)
      ? record.changed_fields.map(String)
      : [],
    beforeData:
      record.before_data && typeof record.before_data === "object"
        ? (record.before_data as Record<string, unknown>)
        : {},
    afterData:
      record.after_data && typeof record.after_data === "object"
        ? (record.after_data as Record<string, unknown>)
        : {},
    createdAt: record.created_at.toISOString(),
  }));
}
