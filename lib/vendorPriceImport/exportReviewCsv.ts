import { formatPercentChange } from './percentChange';
import type { VendorPriceReviewLine } from './vendorPriceImportTypes';

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadReviewLinesCsv(lines: VendorPriceReviewLine[], fileName: string): void {
  const headers = [
    'Part Number',
    'Vendor ID',
    'Nomenclature',
    'Vendor description',
    'Old Cost',
    'Vendor file price',
    'Applied price',
    'Manually adjusted',
    'Change %',
    'Selected',
  ];

  const rows = lines.map((line) => [
    line.pn ?? '',
    line.vendorPartIdNormalized,
    line.nomenclature ?? '',
    line.descriptionFromFile ?? '',
    line.costBefore !== null ? line.costBefore.toFixed(2) : '',
    line.proposedCost.toFixed(2),
    line.costAfter !== null ? line.costAfter.toFixed(2) : line.proposedCost.toFixed(2),
    line.isManuallyAdjusted ? 'yes' : 'no',
    formatPercentChange(line.percentChange),
    line.selected ? 'yes' : 'no',
  ]);

  const csv = [headers, ...rows].map((row) => row.map((c) => csvEscape(String(c))).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
