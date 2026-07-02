import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const JPEG_QUALITY = 90;

export type VisionRenderFailureStage =
  | 'js_runtime_require'
  | 'js_canvas_load'
  | 'js_canvas_polyfill'
  | 'js_pdfjs_load'
  | 'js_pdfjs_render'
  | 'python_render'
  | 'renderer_unavailable';

export class VisionRenderError extends Error {
  stage: VisionRenderFailureStage;
  details: Record<string, unknown> | null;
  causeMessage: string | null;

  constructor(
    stage: VisionRenderFailureStage,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> | null },
  ) {
    super(message);
    this.name = 'VisionRenderError';
    this.stage = stage;
    this.details = options?.details || null;
    this.causeMessage = options?.cause instanceof Error ? options.cause.message : options?.cause ? String(options.cause) : null;
  }
}

export type RenderedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  mimeType: string;
  dataUrl: string;
};

type RenderPdfPagesResponse = {
  pages?: Array<{
    pageNumber?: number;
    width?: number;
    height?: number;
    mimeType?: string;
    dataBase64?: string;
  }>;
};

type PdfJsPage = {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: {
    canvasContext: unknown;
    viewport: unknown;
    background?: string;
  }): { promise: Promise<unknown> };
  cleanup?(): void;
};

type PdfJsDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  destroy(): Promise<void>;
};

type PdfJsLoadingTask = {
  promise: Promise<PdfJsDocument>;
  destroy?(): Promise<void>;
};

type PdfJsModule = {
  getDocument(params: Record<string, unknown>): PdfJsLoadingTask;
  VerbosityLevel?: {
    ERRORS?: number;
  };
  setVerbosityLevel?(level: number): void;
};

type CanvasModule = {
  DOMMatrix?: typeof globalThis.DOMMatrix;
  ImageData?: typeof globalThis.ImageData;
  Path2D?: typeof globalThis.Path2D;
  createCanvas(width: number, height: number): {
    width: number;
    height: number;
    getContext(contextType: '2d'): unknown;
    toBuffer(mimeType: 'image/jpeg', quality?: number): Buffer;
  };
};

function getRuntimeRequire(): NodeRequire {
  const moduleBuiltin = process.getBuiltinModule?.('module') as { createRequire?: (value: string) => NodeRequire } | undefined;
  if (!moduleBuiltin?.createRequire) {
    throw new VisionRenderError('js_runtime_require', 'Node runtime module loader is unavailable for PDF rendering.');
  }
  return moduleBuiltin.createRequire(import.meta.url);
}

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.round(value);
  return normalized > 0 ? normalized : null;
}

function normalizeRequestedPages(pageNumbers: number[]): number[] {
  return Array.from(new Set(pageNumbers.filter((page) => Number.isFinite(page) && page > 0)))
    .map((page) => Math.round(page))
    .filter((page) => page > 0)
    .sort((left, right) => left - right);
}

async function loadCanvasModule(): Promise<CanvasModule> {
  try {
    const runtimeRequire = getRuntimeRequire();
    return runtimeRequire('@napi-rs/canvas') as CanvasModule;
  } catch (error) {
    throw new VisionRenderError('js_canvas_load', 'Failed to load native canvas module for PDF rendering.', {
      cause: error,
    });
  }
}

async function ensureCanvasPolyfills(): Promise<CanvasModule> {
  try {
    const canvas = await loadCanvasModule();
    if (!globalThis.DOMMatrix && canvas.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix;
    }
    if (!globalThis.ImageData && canvas.ImageData) {
      globalThis.ImageData = canvas.ImageData;
    }
    if (!globalThis.Path2D && canvas.Path2D) {
      globalThis.Path2D = canvas.Path2D;
    }
    return canvas;
  } catch (error) {
    if (error instanceof VisionRenderError) throw error;
    throw new VisionRenderError('js_canvas_polyfill', 'Failed to initialize canvas polyfills for PDF rendering.', {
      cause: error,
    });
  }
}

async function loadPdfJs(): Promise<PdfJsModule> {
  try {
    await ensureCanvasPolyfills();
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
    const errorVerbosity = pdfjs.VerbosityLevel?.ERRORS;
    if (typeof errorVerbosity === 'number' && typeof pdfjs.setVerbosityLevel === 'function') {
      pdfjs.setVerbosityLevel(errorVerbosity);
    }
    return pdfjs;
  } catch (error) {
    if (error instanceof VisionRenderError) throw error;
    throw new VisionRenderError('js_pdfjs_load', 'Failed to load pdfjs for rendered-page verification.', {
      cause: error,
    });
  }
}

function toJpegDataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function renderPdfPagesWithPdfJs(
  fileBytes: Buffer,
  pageNumbers: number[],
  dpi: number,
): Promise<RenderedPdfPage[]> {
  try {
    const normalizedPages = normalizeRequestedPages(pageNumbers);
    if (normalizedPages.length === 0) return [];

    const [canvas, pdfjs] = await Promise.all([ensureCanvasPolyfills(), loadPdfJs()]);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBytes),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
    });

    let document: PdfJsDocument | null = null;
    try {
      document = await loadingTask.promise;
      const renderedPages: RenderedPdfPage[] = [];
      const scale = dpi / 72;

      for (const pageNumber of normalizedPages) {
        if (pageNumber < 1 || pageNumber > document.numPages) continue;
        const page = await document.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale });
          const width = Math.max(1, Math.round(viewport.width));
          const height = Math.max(1, Math.round(viewport.height));
          const surface = canvas.createCanvas(width, height);
          const context = surface.getContext('2d');

          await page.render({
            canvasContext: context,
            viewport,
            background: 'rgb(255,255,255)',
          }).promise;

          const imageBuffer = surface.toBuffer('image/jpeg', JPEG_QUALITY);
          renderedPages.push({
            pageNumber,
            width,
            height,
            mimeType: 'image/jpeg',
            dataUrl: toJpegDataUrl(imageBuffer),
          });
        } finally {
          page.cleanup?.();
        }
      }

      return renderedPages;
    } finally {
      if (document) {
        await document.destroy();
      } else {
        await loadingTask.destroy?.();
      }
    }
  } catch (error) {
    if (error instanceof VisionRenderError) throw error;
    throw new VisionRenderError('js_pdfjs_render', 'pdfjs failed while rendering PDF pages for vision verification.', {
      cause: error,
      details: {
        requestedPageCount: normalizeRequestedPages(pageNumbers).length,
        dpi,
      },
    });
  }
}

async function renderPdfPagesWithPython(
  fileBytes: Buffer,
  pageNumbers: number[],
  dpi: number,
): Promise<RenderedPdfPage[]> {
  let tempDir: string | null = null;
  try {
    const normalizedPages = normalizeRequestedPages(pageNumbers);
    if (normalizedPages.length === 0) return [];

    tempDir = await mkdtemp(path.join(os.tmpdir(), 'tf-job-import-'));
    const tempPdfPath = path.join(tempDir, 'source.pdf');
    const scriptPath = path.join(process.cwd(), 'scripts', 'render_pdf_pages.py');

    await writeFile(tempPdfPath, fileBytes);
    const args = [
      scriptPath,
      '--input',
      tempPdfPath,
      '--pages',
      normalizedPages.join(','),
      '--dpi',
      String(dpi),
    ];

    const { stdout } = await execFileAsync('python', args, {
      cwd: process.cwd(),
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as RenderPdfPagesResponse;
    return (parsed.pages || [])
      .map((page) => {
        const pageNumber = normalizePositiveInt(page.pageNumber);
        const width = normalizePositiveInt(page.width);
        const height = normalizePositiveInt(page.height);
        const mimeType = typeof page.mimeType === 'string' ? page.mimeType.trim() : 'image/jpeg';
        const dataBase64 = typeof page.dataBase64 === 'string' ? page.dataBase64.trim() : '';
        if (!pageNumber || !width || !height || !dataBase64) {
          return null;
        }
        return {
          pageNumber,
          width,
          height,
          mimeType,
          dataUrl: `data:${mimeType};base64,${dataBase64}`,
        } satisfies RenderedPdfPage;
      })
      .filter((page): page is RenderedPdfPage => !!page);
  } catch (error) {
    if (error instanceof VisionRenderError) throw error;
    throw new VisionRenderError('python_render', 'Python fallback renderer failed.', {
      cause: error,
    });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function renderPdfPagesForVision(
  fileBytes: Buffer,
  pageNumbers: number[],
  dpi = 180,
): Promise<RenderedPdfPage[]> {
  try {
    return await renderPdfPagesWithPdfJs(fileBytes, pageNumbers, dpi);
  } catch (jsError) {
    try {
      return await renderPdfPagesWithPython(fileBytes, pageNumbers, dpi);
    } catch (pythonError) {
      throw new VisionRenderError('renderer_unavailable', 'PDF rendering failed in both JS and Python paths.', {
        cause: pythonError,
        details: {
          jsStage: jsError instanceof VisionRenderError ? jsError.stage : 'unknown',
          jsMessage: jsError instanceof Error ? jsError.message : String(jsError),
          jsCauseMessage: jsError instanceof VisionRenderError ? jsError.causeMessage : null,
          pythonStage: pythonError instanceof VisionRenderError ? pythonError.stage : 'unknown',
          pythonMessage: pythonError instanceof Error ? pythonError.message : String(pythonError),
          pythonCauseMessage: pythonError instanceof VisionRenderError ? pythonError.causeMessage : null,
        },
      });
    }
  }
}
