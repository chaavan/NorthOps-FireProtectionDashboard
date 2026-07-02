/**
 * Fails CI if catalog profile fields on `Part` are written outside the part info ledger + explicit admin/script allowlist.
 *
 * Tracked: pn, nomenclature, units, vendor, vendorPartID, altPN (not cost — see part-cost-write-guard).
 *
 * Run: npx tsx scripts/part-info-write-guard.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const ALLOW_FILES = new Set<string>(
  [
    path.join(ROOT, 'lib', 'partInfoLedger.ts'),
    path.join(ROOT, 'app', 'api', 'admin', 'parts', '[id]', 'route.ts'),
    path.join(ROOT, 'app', 'api', 'admin', 'parts', 'create', 'route.ts'),
    path.join(ROOT, 'scripts', 'import-parts.ts'),
  ].map((p) => p.replace(/\\/g, '/')),
);

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage']);

/** Prisma client field names in `data: { ... }` for Part model. */
const PROFILE_FIELD_RE =
  /\b(pn|nomenclature|units|vendor|vendorPartID|altPN)\s*:/m;

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

function dataBlockTouchesProfile(dataBody: string): boolean {
  return PROFILE_FIELD_RE.test(dataBody);
}

function prismaCallInnerTouchesProfileInData(
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
          if (dataBlockTouchesProfile(dataBody)) return true;
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

    if (prismaCallInnerTouchesProfileInData(content, 'update')) {
      violations.push(
        `${rel}: part.update assigns profile fields (use lib/partInfoLedger via allowlisted admin route or import script)`,
      );
    }
    if (prismaCallInnerTouchesProfileInData(content, 'create')) {
      violations.push(
        `${rel}: part.create assigns profile fields (use allowlisted create/import path with ledger)`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('part-info-write-guard: forbidden catalog profile writes:\n');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log('part-info-write-guard: OK (no forbidden part profile writes outside ledger/allowlist)');
}

main();
