/**
 * Fails CI if Part.catalog cost (`parts.cost`) is written outside the part cost ledger + explicit admin/script allowlist.
 *
 * Run: npx tsx scripts/part-cost-write-guard.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const ALLOW_FILES = new Set<string>(
  [
    path.join(ROOT, 'lib', 'partCostLedger.ts'),
    path.join(ROOT, 'app', 'api', 'admin', 'parts', '[id]', 'route.ts'),
    path.join(ROOT, 'app', 'api', 'admin', 'parts', 'create', 'route.ts'),
    path.join(ROOT, 'scripts', 'import-parts.ts'),
  ].map((p) => p.replace(/\\/g, '/')),
);

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage']);

const RAW_PARTS_COST = /UPDATE\s+["']?parts["']?[\s\S]*?SET\s+[\s\S]*?\bcost\s*=/i;

function normalize(p: string) {
  return p.replace(/\\/g, '/');
}

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

function dataBlockSetsCost(dataBody: string): boolean {
  return /\bcost\s*:/m.test(dataBody);
}

function prismaCallInnerSetsCostInData(
  content: string,
  method: 'update' | 'create',
): boolean {
  const re = new RegExp(`\\.part\\.${method}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const openParenIdx = m.index + m[0].length - 1;
    const inner = sliceMatchingParen(content, openParenIdx);
    if (!inner) continue;
    const dm = /\bdata\s*:\s*\{/.exec(inner);
    if (!dm || dm.index === undefined) continue;
    const braceStart = inner.indexOf('{', dm.index);
    if (braceStart < 0) continue;
    let depth = 0;
    for (let i = braceStart; i < inner.length; i++) {
      const c = inner[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const dataBody = inner.slice(braceStart + 1, i);
          if (dataBlockSetsCost(dataBody)) return true;
          break;
        }
      }
    }
  }
  return false;
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

    if (prismaCallInnerSetsCostInData(content, 'update')) {
      violations.push(`${rel}: part.update assigns data.cost (use lib/partCostLedger or allowlisted admin route)`);
    }
    if (prismaCallInnerSetsCostInData(content, 'create')) {
      violations.push(`${rel}: part.create assigns data.cost (use lib/partCostLedger or allowlisted create/import)`);
    }
    if (RAW_PARTS_COST.test(content) && !norm.includes('partCostLedger')) {
      violations.push(`${rel}: raw SQL updates parts.cost (use lib/partCostLedger)`);
    }
  }

  if (violations.length > 0) {
    console.error('part-cost-write-guard: forbidden catalog cost writes:\n');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log('part-cost-write-guard: OK (no forbidden part cost writes outside ledger/allowlist)');
}

main();
