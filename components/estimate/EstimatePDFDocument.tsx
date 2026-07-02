import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EstimateComputed, EstimateVisibleMaterialLine } from "@/lib/estimateTypes";

type Props = {
  computed: EstimateComputed;
  logoDataUri?: string | null;
  generatedAtDisplay: string;
  variantLabel?: string | null;
  standaloneTitle?: string | null;
};

export type EstimateVariantPageProps = Props;

const BRAND_NAVY = "#0c2742";
const BORDER = "#d7e0ea";
const MUTED = "#5c6b7a";
const LIGHT_BG = "#f3f6fa";

const styles = StyleSheet.create({
  page: {
    paddingTop: 76,
    paddingBottom: 40,
    paddingHorizontal: 34,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    position: "absolute",
    top: 18,
    left: 34,
    right: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: BRAND_NAVY,
    paddingBottom: 9,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 42, height: 42, objectFit: "contain" },
  brandName: { color: BRAND_NAVY, fontSize: 16, fontWeight: 700 },
  brandSub: { color: MUTED, fontSize: 8, marginTop: 2 },
  headerMeta: { textAlign: "right", color: MUTED, fontSize: 8, lineHeight: 1.35 },
  title: { color: BRAND_NAVY, fontSize: 20, fontWeight: 700, marginBottom: 10 },
  grid: { flexDirection: "row", gap: 10, marginBottom: 14 },
  panel: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_BG,
    padding: 10,
  },
  label: { color: MUTED, fontSize: 7, textTransform: "uppercase", marginBottom: 2 },
  value: { color: "#111827", fontSize: 10, fontWeight: 700, marginBottom: 6 },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 6,
    color: BRAND_NAVY,
    fontSize: 13,
    fontWeight: 700,
  },
  table: { borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: BRAND_NAVY,
    color: "#ffffff",
    fontSize: 7,
    fontWeight: 700,
  },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER },
  childRow: { backgroundColor: "#f8fafc" },
  cell: { padding: 5, borderRightWidth: 1, borderRightColor: BORDER },
  cPart: { width: "14%" },
  cDesc: { width: "28%" },
  cVendor: { width: "12%" },
  cQty: { width: "8%", textAlign: "right" },
  cMoney: { width: "11%", textAlign: "right" },
  cRule: { width: "8%", textAlign: "right" },
  cTotal: { width: "8%", textAlign: "right", borderRightWidth: 0 },
  muted: { color: MUTED },
  totals: {
    marginLeft: "auto",
    width: "44%",
    borderWidth: 1,
    borderColor: BORDER,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  totalFirst: { borderTopWidth: 0 },
  totalFinal: { backgroundColor: BRAND_NAVY, color: "#ffffff", fontWeight: 700 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 34,
    right: 34,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 6,
    color: MUTED,
    fontSize: 7,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function number(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function text(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "-";
}

function MaterialRow({ line }: { line: EstimateVisibleMaterialLine }) {
  const isAuto = line.autoSource === "rule";
  return (
    <View style={[styles.row, ...(isAuto ? [styles.childRow] : [])]} wrap={false}>
      <Text style={[styles.cell, styles.cPart]}>
        {isAuto ? "AUTO " : ""}
        {text(line.partNumber)}
      </Text>
      <Text style={[styles.cell, styles.cDesc]}>
        {text(line.description)}
        {line.autoQty > 0 ? ` (+${number(line.autoQty)} auto)` : ""}
      </Text>
      <Text style={[styles.cell, styles.cVendor]}>{text(line.supplier)}</Text>
      <Text style={[styles.cell, styles.cQty]}>{number(line.effectiveQuantity)}</Text>
      <Text style={[styles.cell, styles.cMoney]}>
        {money(line.baseUnitPrice ?? line.databaseUnitPrice)}
      </Text>
      <Text style={[styles.cell, styles.cRule]}>
        {line.vendorAdjustmentPercent ? `${line.vendorAdjustmentPercent}%` : "-"}
      </Text>
      <Text style={[styles.cell, styles.cMoney]}>
        {money(line.adjustedUnitPrice ?? line.resolvedUnitPrice)}
      </Text>
      <Text style={[styles.cell, styles.cTotal]}>{money(line.lineTotal)}</Text>
    </View>
  );
}

function TotalRow({
  label,
  value,
  first = false,
  final = false,
}: {
  label: string;
  value: number | null;
  first?: boolean;
  final?: boolean;
}) {
  return (
    <View
      style={[
        styles.totalRow,
        ...(first ? [styles.totalFirst] : []),
        ...(final ? [styles.totalFinal] : []),
      ]}
    >
      <Text>{label}</Text>
      <Text>{money(value)}</Text>
    </View>
  );
}

export function EstimateVariantPage({
  computed,
  logoDataUri,
  generatedAtDisplay,
  variantLabel,
  standaloneTitle,
}: Props) {
  const { draft, summary } = computed;
  const rules = draft.materials.vendorAdjustments ?? [];

  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.header} fixed>
        <View style={styles.brand}>
          {logoDataUri ? <Image src={logoDataUri} style={styles.logo} /> : null}
          <View>
            <Text style={styles.brandName}>Total Fire Protection</Text>
            <Text style={styles.brandSub}>Standalone Estimate</Text>
          </View>
        </View>
        <View style={styles.headerMeta}>
          <Text>Generated {generatedAtDisplay}</Text>
          {variantLabel ? <Text>Variant: {variantLabel}</Text> : null}
        </View>
      </View>

      <Text style={styles.title}>{draft.project.projectName || standaloneTitle || "Estimate"}</Text>

      <View style={styles.grid}>
        <View style={styles.panel}>
          <Text style={styles.label}>Project Date</Text>
          <Text style={styles.value}>{draft.project.date || "-"}</Text>
          <Text style={styles.label}>Bid Due Date</Text>
          <Text style={styles.value}>{draft.project.bidDueDate || "-"}</Text>
          <Text style={styles.label}>Estimator</Text>
          <Text style={styles.value}>{draft.project.estimator || "-"}</Text>
        </View>
        <View style={styles.panel}>
          <Text style={styles.label}>System</Text>
          <Text style={styles.value}>{draft.project.systemLabel || "-"}</Text>
          <Text style={styles.label}>Location</Text>
          <Text style={styles.value}>
            {draft.project.projectLocationLine1 || "-"}
            {draft.project.projectLocationLine2 ? `, ${draft.project.projectLocationLine2}` : ""}
          </Text>
          <Text style={styles.label}>Total</Text>
          <Text style={styles.value}>{money(summary.totalCost)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Materials</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.cell, styles.cPart]}>Part</Text>
          <Text style={[styles.cell, styles.cDesc]}>Description</Text>
          <Text style={[styles.cell, styles.cVendor]}>Vendor</Text>
          <Text style={[styles.cell, styles.cQty]}>Qty</Text>
          <Text style={[styles.cell, styles.cMoney]}>Base</Text>
          <Text style={[styles.cell, styles.cRule]}>Rule</Text>
          <Text style={[styles.cell, styles.cMoney]}>Final</Text>
          <Text style={[styles.cell, styles.cTotal]}>Total</Text>
        </View>
        {computed.visibleMaterialLines.length === 0 ? (
          <View style={styles.row}>
            <Text style={[styles.cell, { width: "100%", borderRightWidth: 0 }]}>
              No material lines.
            </Text>
          </View>
        ) : (
          computed.visibleMaterialLines.map((line) => (
            <MaterialRow key={line.lineKey} line={line} />
          ))
        )}
      </View>

      {rules.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>Vendor Rules</Text>
          <View style={styles.table}>
            {rules.map((rule) => (
              <View key={rule.id} style={styles.row}>
                <Text style={[styles.cell, { width: "70%" }]}>{text(rule.vendor)}</Text>
                <Text style={[styles.cell, { width: "30%", textAlign: "right", borderRightWidth: 0 }]}>
                  {text(rule.percent)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Totals</Text>
      <View style={styles.totals}>
        <TotalRow first label="Material subtotal" value={summary.materialSubtotal} />
        <TotalRow label="Sales tax" value={summary.salesTaxCost} />
        <TotalRow label="Material inflation" value={summary.materialInflationCost} />
        <TotalRow label="Total material" value={summary.totalMaterialCost} />
        <TotalRow label="Field cost" value={summary.totalFieldCost} />
        <TotalRow label="Shop cost" value={summary.totalShopCost} />
        <TotalRow label="Design cost" value={summary.totalDesignCost} />
        <TotalRow label="Subs & misc" value={summary.subsTotal} />
        <TotalRow label="Overhead" value={summary.overheadCost} />
        <TotalRow label="Profit" value={summary.profitCost} />
        <TotalRow label="Fees / PE / Bond" value={summary.feesTotal} />
        <TotalRow final label="Final total" value={summary.totalCost} />
      </View>

      <View style={styles.footer} fixed>
        <Text>Total Fire Protection</Text>
        <Text>Estimate export</Text>
      </View>
    </Page>
  );
}

export default function EstimatePDFDocument(props: Props) {
  return (
    <Document>
      <EstimateVariantPage {...props} />
    </Document>
  );
}
