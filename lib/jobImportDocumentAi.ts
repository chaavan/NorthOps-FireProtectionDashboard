import { google } from 'googleapis';
import { parseLenientJsonString } from '@/lib/jobImportJsonParse';

type DocumentAiConfig = {
  credentials: Record<string, unknown>;
  projectId: string;
  location: string;
  processorId: string;
};

export type DocumentAiNormalizedBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocumentAiToken = {
  text: string;
  bbox: DocumentAiNormalizedBoundingBox | null;
  readingOrder: number;
};

export type DocumentAiLine = {
  text: string;
  bbox: DocumentAiNormalizedBoundingBox | null;
  readingOrder: number;
  tokens: DocumentAiToken[];
};

export type DocumentAiPage = {
  pageNumber: number;
  width: number;
  height: number;
  lines: DocumentAiLine[];
  tokens: DocumentAiToken[];
};

export type DocumentAiExtractionResult = {
  text: string;
  pageCount: number;
  mimeType: string;
  pages: DocumentAiPage[];
  layoutProfile: 'tf_material_picksheet_v1' | 'unknown';
};

const DOCUMENT_AI_MAX_SIZE_BYTES = 40 * 1024 * 1024;

type DocumentAiNormalizedVertex = {
  x?: number;
  y?: number;
};

type DocumentAiVertex = {
  x?: number;
  y?: number;
};

type DocumentAiTextSegment = {
  startIndex?: string;
  endIndex?: string;
};

type DocumentAiTextAnchor = {
  textSegments?: DocumentAiTextSegment[];
};

type DocumentAiBoundingPoly = {
  normalizedVertices?: DocumentAiNormalizedVertex[];
  vertices?: DocumentAiVertex[];
};

type DocumentAiLayout = {
  textAnchor?: DocumentAiTextAnchor;
  boundingPoly?: DocumentAiBoundingPoly;
};

type DocumentAiPageEntity = {
  layout?: DocumentAiLayout;
};

type DocumentAiRawPage = {
  pageNumber?: number;
  dimension?: {
    width?: number;
    height?: number;
  };
  lines?: DocumentAiPageEntity[];
  tokens?: DocumentAiPageEntity[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function getTextFromAnchor(fullText: string, anchor?: DocumentAiTextAnchor): string {
  const segments = anchor?.textSegments || [];
  if (segments.length === 0) return '';

  return segments
    .map((segment) => {
      const start = Number(segment.startIndex || 0);
      const end = Number(segment.endIndex || 0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
      return fullText.slice(start, end);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBoundingBox(
  layout: DocumentAiLayout | undefined,
  pageWidth: number,
  pageHeight: number,
): DocumentAiNormalizedBoundingBox | null {
  const normalized = layout?.boundingPoly?.normalizedVertices;
  if (Array.isArray(normalized) && normalized.length > 0) {
    const xs = normalized.map((vertex) => clamp01(Number(vertex.x || 0)));
    const ys = normalized.map((vertex) => clamp01(Number(vertex.y || 0)));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }

  const absolute = layout?.boundingPoly?.vertices;
  if (Array.isArray(absolute) && absolute.length > 0 && pageWidth > 0 && pageHeight > 0) {
    const xs = absolute.map((vertex) => clamp01(Number(vertex.x || 0) / pageWidth));
    const ys = absolute.map((vertex) => clamp01(Number(vertex.y || 0) / pageHeight));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }

  return null;
}

function buildDocumentPages(rawPages: DocumentAiRawPage[] | undefined, fullText: string): DocumentAiPage[] {
  const pages = (rawPages || []).map((page, pageIndex) => {
    const width = Number(page.dimension?.width || 0);
    const height = Number(page.dimension?.height || 0);
    const lines = (page.lines || [])
      .map((line, lineIndex) => {
        const text = getTextFromAnchor(fullText, line.layout?.textAnchor);
        if (!text) return null;
        return {
          text,
          bbox: getBoundingBox(line.layout, width, height),
          readingOrder: lineIndex,
          tokens: [],
        } satisfies DocumentAiLine;
      })
      .filter(Boolean) as DocumentAiLine[];
    const tokens = (page.tokens || [])
      .map((token, tokenIndex) => {
        const text = getTextFromAnchor(fullText, token.layout?.textAnchor);
        if (!text) return null;
        return {
          text,
          bbox: getBoundingBox(token.layout, width, height),
          readingOrder: tokenIndex,
        } satisfies DocumentAiToken;
      })
      .filter(Boolean) as DocumentAiToken[];

    for (const line of lines) {
      const lineBox = line.bbox;
      if (!lineBox) continue;
      line.tokens = tokens.filter((token) => {
        if (!token.bbox) return false;
        const tokenCenterY = token.bbox.y + token.bbox.height / 2;
        const tokenCenterX = token.bbox.x + token.bbox.width / 2;
        const insideY = tokenCenterY >= lineBox.y - 0.01 && tokenCenterY <= lineBox.y + lineBox.height + 0.01;
        const insideX = tokenCenterX >= lineBox.x - 0.01 && tokenCenterX <= lineBox.x + lineBox.width + 0.01;
        return insideX && insideY;
      });
    }

    return {
      pageNumber: Number(page.pageNumber || pageIndex + 1),
      width,
      height,
      lines,
      tokens,
    } satisfies DocumentAiPage;
  });

  return pages;
}

function pageTextLooksLikePartColumnHeader(pageText: string): boolean {
  return (
    pageText.includes('PART NO') ||
    pageText.includes('PARTNO') ||
    pageText.includes('PART NUMBER') ||
    (pageText.includes('PART') && pageText.includes('NO.')) ||
    (pageText.includes('PART') && pageText.includes(' NO'))
  );
}

function detectLayoutProfile(text: string, pages: DocumentAiPage[]): 'tf_material_picksheet_v1' | 'unknown' {
  const normalizedText = text.toUpperCase();
  const hasPacketHeader =
    normalizedText.includes('MATERIAL PICKSHEET') &&
    normalizedText.includes('DESCRIPTION') &&
    (normalizedText.includes('PART NO') ||
      normalizedText.includes('PARTNO') ||
      normalizedText.includes('PART NUMBER'));
  const hasTableAnchors = pages.some((page) => {
    const pageText = page.lines.map((line) => line.text.toUpperCase()).join('\n');
    return (
      pageText.includes('LOOSE') &&
      (pageText.includes("FAB'D") || pageText.includes('FABD') || pageText.includes('FAB')) &&
      (pageText.includes('TOTAL') || pageText.includes('TOT ')) &&
      pageText.includes('DESCRIPTION') &&
      pageTextLooksLikePartColumnHeader(pageText)
    );
  });
  /** OCR often drops spaces or FAB/TOTAL tokens; still clearly a material grid. */
  const hasLooseMaterialGrid = pages.some((page) => {
    const pageText = page.lines.map((line) => line.text.toUpperCase()).join('\n');
    return (
      pageText.includes('LOOSE') &&
      pageText.includes('DESCRIPTION') &&
      pageTextLooksLikePartColumnHeader(pageText) &&
      (pageText.includes('MATERIAL PICKSHEET') ||
        (normalizedText.includes('MATERIAL') && normalizedText.includes('PICKSHEET')))
    );
  });

  return hasPacketHeader && hasTableAnchors || hasLooseMaterialGrid ? 'tf_material_picksheet_v1' : 'unknown';
}

function parseServiceAccountJson(rawJson: string): Record<string, unknown> {
  let normalized = rawJson.trim();

  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1).replace(/\\"/g, '"');
  }

  const parsed = parseLenientJsonString<Record<string, unknown>>(normalized);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
  }
  return parsed;
}

function getDocumentAiConfig(): DocumentAiConfig {
  const projectId = process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID?.trim();
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION?.trim();
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID?.trim();
  const rawCredentials =
    process.env.GOOGLE_DOCUMENT_AI_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!rawCredentials || !projectId || !location || !processorId) {
    const missing = [
      !rawCredentials ? 'GOOGLE_DOCUMENT_AI_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_JSON)' : null,
      !projectId ? 'GOOGLE_DOCUMENT_AI_PROJECT_ID' : null,
      !location ? 'GOOGLE_DOCUMENT_AI_LOCATION' : null,
      !processorId ? 'GOOGLE_DOCUMENT_AI_PROCESSOR_ID' : null,
    ]
      .filter(Boolean)
      .join(', ');

    throw new Error(`Document AI OCR is not configured. Missing: ${missing}`);
  }

  return {
    credentials: parseServiceAccountJson(rawCredentials),
    projectId,
    location,
    processorId,
  };
}

async function getAccessToken(credentials: Record<string, unknown>): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const tokenValue = await client.getAccessToken();
  const token =
    typeof tokenValue === 'string'
      ? tokenValue
      : tokenValue?.token || null;

  if (!token) {
    throw new Error('Failed to obtain a Google Cloud access token for Document AI.');
  }

  return token;
}

export async function extractTextFromPdfWithDocumentAi(
  buffer: Buffer,
): Promise<DocumentAiExtractionResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('PDF buffer is empty.');
  }

  if (buffer.length > DOCUMENT_AI_MAX_SIZE_BYTES) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `PDF file is too large (${sizeMb} MB). Document AI online processing supports up to 40 MB.`,
    );
  }

  const { credentials, projectId, location, processorId } = getDocumentAiConfig();
  const token = await getAccessToken(credentials);
  const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rawDocument: {
        mimeType: 'application/pdf',
        content: buffer.toString('base64'),
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        document?: {
          text?: string;
          pages?: Array<unknown>;
          mimeType?: string;
        };
        error?: { message?: string; code?: number };
      }
    | null;

  if (!response.ok) {
    const errorMessage =
      payload?.error?.message ||
      `Document AI request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  const text = payload?.document?.text?.trim() || '';
  if (!text) {
    throw new Error('Document AI returned no text for this PDF.');
  }

  const pages = buildDocumentPages(payload?.document?.pages as DocumentAiRawPage[] | undefined, text);

  return {
    text,
    pageCount: payload?.document?.pages?.length || 0,
    mimeType: payload?.document?.mimeType || 'application/pdf',
    pages,
    layoutProfile: detectLayoutProfile(text, pages),
  };
}
