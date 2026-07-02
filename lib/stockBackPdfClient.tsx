'use client';

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import StockBackPDF from '@/components/StockBackPDF';
import {
  getStockBackLinesMissingCosts,
  type StockBackPdfDocument,
} from '@/lib/stockBackPdfShared';
import { toDateKeyInAppTimeZone } from '@/lib/timezone';

export async function downloadStockBackPdf(document: StockBackPdfDocument) {
  const missingCosts = getStockBackLinesMissingCosts(document.lines);
  if (missingCosts.length > 0) {
    throw new Error(
      `Cannot generate stock-back PDF. Missing unit costs for: ${missingCosts.join(', ')}`,
    );
  }

  const pdfInstance = pdf(<StockBackPDF document={document} />);
  const blob = await pdfInstance.toBlob();
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `SB-${document.jobNumber}-${toDateKeyInAppTimeZone(document.createdAt)}.pdf`;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
