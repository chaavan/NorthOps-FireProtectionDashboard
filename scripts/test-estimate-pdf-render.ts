import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import EstimatePDFDocument from "../components/estimate/EstimatePDFDocument";
import type { EstimateComputed } from "../lib/estimateTypes";

const visibleLine = {
  lineKey: "1",
  autoSource: "rule" as const,
  manualQty: 0,
  autoQty: 2,
  effectiveQuantity: 2,
  partNumber: "P1",
  description: "Desc",
  supplier: "V",
  databaseUnitPrice: 10,
  manualUnitPrice: null,
  resolvedUnitPrice: 10,
  priceSource: "catalog" as const,
  blockingReason: null,
  lineTotal: 20,
  rowIndex: 0,
};

const computed = {
  draft: {
    project: {
      projectName: "Test",
      date: "2026-01-01",
      bidDueDate: "",
      estimator: "",
      systemLabel: "Base",
      projectLocationLine1: "Loc",
      projectLocationLine2: "",
      buildingTypeOptionId: null,
      buildingTypeOther: null,
      jobTypeOptionId: null,
      jobTypeOther: null,
      salesType: null,
      confidenceLevel: null,
      squareFootage: null,
    },
    inputs: {
      salesTaxPercent: 0,
      materialInflationPercent: 0,
      overheadPercent: 0,
      profitPercent: 0,
      subsMarkupPercent: 0,
      milesToJobSite: 0,
      peStamp: 0,
      bondCost: 0,
    },
    materials: {
      visibleLines: [visibleLine],
      vendorAdjustments: [{ id: "r1", vendor: "Viking", percent: 5 }],
    },
    field: { manualHours: {} },
    shop: { inputs: {} },
    design: { inputs: {} },
    subsAndFees: { miscellaneousCosts: {}, miscellaneousLabels: {} },
  },
  summary: {
    materialSubtotal: 20,
    materialLinesSubtotal: 20,
    sectionAdjustmentsTotal: 0,
    salesTaxCost: 0,
    materialInflationCost: 0,
    totalMaterialCost: 20,
    totalFieldHours: 0,
    totalFieldCost: 0,
    totalShopHours: 0,
    totalShopCost: 0,
    totalDesignHours: 0,
    totalDesignCost: 0,
    subtotal: 20,
    overheadCost: 0,
    subtotalWithOverhead: 20,
    profitCost: 0,
    subtotalWithProfit: 20,
    subsSubtotal: 0,
    subsMarkupCost: 0,
    subsTotal: 0,
    fees: 0,
    feesTotal: 0,
    peStamp: 0,
    bondCost: 0,
    totalCost: 20,
    grandTotalLaborHours: 0,
    totalSprinklers: 0,
    materialCostPerHead: null,
    totalCostPerHead: null,
    hoursPerHead: null,
    totalCostPerSquareFoot: null,
    travelZone: null,
  },
  parity: { canExportPdf: true, issues: [] },
  projectDisplayRows: [],
  fieldRows: [],
  shopRows: [],
  designRows: [],
  materials: [],
  visibleMaterialLines: [visibleLine],
  sectionAdjustments: [],
  totalsBySection: [],
  summaryRows: [],
} as EstimateComputed;

async function main() {
  const buffer = await renderToBuffer(
    React.createElement(EstimatePDFDocument, {
      computed,
      generatedAtDisplay: "now",
      variantLabel: null,
      standaloneTitle: "Test",
    }),
  );
  console.log("PDF bytes:", buffer.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
