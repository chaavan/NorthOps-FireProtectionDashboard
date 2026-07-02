import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import EstimatePDFDocument from "@/components/estimate/EstimatePDFDocument";
import type { EstimateComputed } from "@/lib/estimateTypes";

export type RenderStandaloneEstimatePdfParams = {
  computed: EstimateComputed;
  logoDataUri?: string | null;
  generatedAtDisplay: string;
  variantLabel?: string | null;
  standaloneTitle?: string | null;
};

export async function renderStandaloneEstimatePdfBuffer(
  params: RenderStandaloneEstimatePdfParams,
): Promise<Buffer> {
  const pdfBuffer = await renderToBuffer(
    React.createElement(EstimatePDFDocument, params) as React.ReactElement,
  );
  return Buffer.from(pdfBuffer);
}
