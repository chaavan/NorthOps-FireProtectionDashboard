/**
 * Fails CI if parts.quantity is updated outside the centralized inventory ledger.
 * Allowlist: lib/inventoryLedger.ts (and Prisma migrations if added later).
 *
 * Run: npx tsx scripts/inventory-write-guard.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const ALLOW_FILES = new Set<string>([
  path.join(ROOT, 'lib', 'inventoryLedger.ts').replace(/\\/g, '/'),
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'coverage',
]);

/** Raw SQL touching parts.quantity */
const RAW_PARTS_QUANTITY = /UPDATE\s+parts[\s\S]*?SET\s+quantity\s*=/i;

/** Slice inside matching parentheses starting at openParenIdx (that index must be `(`). */
function sliceMatchingParen(s: string, openParenIdx: number): string | null {
  let depth = 0;
  for (let i = openParenIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return s.slice(openParenIdx + 1, i);
    }
  }
  return null;
}

/** True if Prisma `data: { ... }` in a part.update(...) call assigns `quantity`. */
function prismaPartUpdateSetsQuantityInData(callInner: string): boolean {
  const m = /\bdata\s*:\s*\{/.exec(callInner);
  if (!m || m.index === undefined) return false;
  const braceStart = callInner.indexOf('{', m.index);
  if (braceStart < 0) return false;
  let depth = 0;
  for (let i = braceStart; i < callInner.length; i++) {
    const c = callInner[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const dataBody = callInner.slice(braceStart + 1, i);
        return /\bquantity\s*:/m.test(dataBody);
      }
    }
  }
  return false;
}

/** Scan for `.part.update(` / `tx.part.update(` and inspect only the Prisma `data` payload. */
function fileContainsForbiddenPartUpdateQuantity(content: string): boolean {
  const re = /\.part\.update\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const openParenIdx = m.index + m[0].length - 1;
    const inner = sliceMatchingParen(content, openParenIdx);
    if (inner && prismaPartUpdateSetsQuantityInData(inner)) return true;
  }
  return false;
}

function normalize(p: string) {
  return p.replace(/\\/g, '/');
}

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

function main() {
  const dirs = ['app', 'lib', 'scripts'].map((d) => path.join(ROOT, d));
  const files: string[] = [];
  for (const d of dirs) walk(d, files);

  const violations: string[] = [];

  for (const file of files) {
    const norm = normalize(file);
    if (ALLOW_FILES.has(norm)) continue;

    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);

    if (fileContainsForbiddenPartUpdateQuantity(content)) {
      violations.push(`${rel}: contains prisma/tx.part.update data.quantity (use lib/inventoryLedger)`);
    }
    if (RAW_PARTS_QUANTITY.test(content) && !norm.includes('inventoryLedger')) {
      violations.push(`${rel}: contains raw UPDATE parts SET quantity (use lib/inventoryLedger)`);
    }
  }

  if (violations.length > 0) {
    console.error('inventory-write-guard: forbidden inventory quantity writes:\n');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log('inventory-write-guard: OK (no forbidden part quantity writes outside ledger)');
}

main();
