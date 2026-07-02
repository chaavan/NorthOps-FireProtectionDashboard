import fs from "fs";
import path from "path";

const LOGO_CANDIDATES = [
  "public/estimate-logo.png",
  "public/logo.png",
  "public/brand/logo.png",
];

/**
 * Load a PNG logo for server-side estimate PDF rendering (base64 data URI).
 * Uses a dedicated asset so dashboard/tab icon routes are unaffected.
 */
export function loadEstimatePdfLogoDataUri(): string | undefined {
  for (const relative of LOGO_CANDIDATES) {
    const full = path.join(process.cwd(), relative);
    try {
      if (!fs.existsSync(full)) continue;
      const buf = fs.readFileSync(full);
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      continue;
    }
  }
  return undefined;
}
