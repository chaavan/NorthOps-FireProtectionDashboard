import { NextResponse } from 'next/server';
import { google } from 'googleapis';

const PARTS_SPREADSHEET_ID = '1U-az1-yK4p-GZAbdoK9O9ujM4belavYeBRNogxxEwUQ';
const PARTS_SHEET_GID = 217567589; // From user's URL (PN sheet)
const PART_NUMBER_COLUMN_INDEX = 0; // Column A (1st column)
const SUPPLIER_COLUMN_INDEX = 11; // Column L (12th column)

/**
 * GET /api/parts/debug
 * 
 * Debug endpoint to see the structure of the PN sheet
 * Shows first 10 rows with all columns
 */
export async function GET() {
  try {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!serviceAccountJson) {
      return NextResponse.json(
        { error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' },
        { status: 500 }
      );
    }

    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // First, get all sheet names
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: PARTS_SPREADSHEET_ID,
    });

    const sheetsList = metadata.data.sheets || [];
    const partsSheet = sheetsList.find(s => s.properties?.sheetId === PARTS_SHEET_GID);
    
    if (!partsSheet?.properties?.title) {
      return NextResponse.json({
        error: `Could not find sheet with gid ${PARTS_SHEET_GID}`,
        availableSheets: sheetsList.map(s => ({
          name: s.properties?.title,
          gid: s.properties?.sheetId
        }))
      }, { status: 404 });
    }

    const sheetName = partsSheet.properties.title;

    // Get first row (headers)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: PARTS_SPREADSHEET_ID,
      range: `'${sheetName}'!1:1`,
    });

    // Get first 20 data rows for better debugging
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: PARTS_SPREADSHEET_ID,
      range: `'${sheetName}'!2:21`,
    });

    const headers = headerResponse.data.values?.[0] || [];
    const rows = dataResponse.data.values || [];

    // Hardcoded columns as per user specification
    const partNumberCol = PART_NUMBER_COLUMN_INDEX; // Column B
    const supplierCol = SUPPLIER_COLUMN_INDEX; // Column L

    // Format data for display
    const formattedData = rows.slice(0, 10).map((row, idx) => {
      const formatted: any = { rowNumber: idx + 2 };
      headers.forEach((header, colIdx) => {
        formatted[`Col_${String.fromCharCode(65 + colIdx)}_${header}`] = row[colIdx] || '';
      });
      return formatted;
    });

    return NextResponse.json({
      spreadsheetId: PARTS_SPREADSHEET_ID,
      sheet: sheetName,
      sheetGid: PARTS_SHEET_GID,
      totalRows: rows.length,
      headers: headers,
      detectedColumns: {
        partNumber: {
          index: partNumberCol,
          letter: 'A',
          header: headers[partNumberCol] || 'N/A',
          note: 'Column A (1st column, index 0) is hardcoded as per user requirement'
        },
        supplier: {
          index: supplierCol,
          letter: 'L',
          header: headers[supplierCol] || 'N/A',
          note: 'Column L (12th column, index 11) is hardcoded as per user requirement'
        },
      },
      sampleData: formattedData,
      rawSampleRows: rows.slice(0, 5),
      message: 'Using sheet gid 217567589: Part numbers from column A (index 0), Suppliers from column L (index 11) as specified by user'
    });
  } catch (error) {
    console.error('Error debugging PN sheet:', error);
    return NextResponse.json(
      { error: 'Failed to read PN sheet', details: (error as Error).message },
      { status: 500 }
    );
  }
}

