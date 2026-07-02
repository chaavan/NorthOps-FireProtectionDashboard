import * as XLSX from 'xlsx';

export function readSpreadsheetRows(fileBytes: Buffer, fileName: string): unknown[][] {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const workbook =
    ext === 'csv'
      ? XLSX.read(fileBytes, { type: 'buffer', raw: false })
      : XLSX.read(fileBytes, { type: 'buffer', raw: false });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('The file has no worksheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  return rows;
}

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function cellToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,]/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}
