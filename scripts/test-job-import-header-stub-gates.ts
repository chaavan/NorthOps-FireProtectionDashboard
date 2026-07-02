/**
 * Smoke checks for header-stub import intent normalization.
 * Run: npx tsx scripts/test-job-import-header-stub-gates.ts
 */
import assert from 'node:assert/strict';
import {
  normalizeJobImportIntent,
  NO_PARTS_PLACEHOLDER_PART_NUMBER,
  shouldUseHeaderStubImportPath,
} from '../lib/jobImportConstants';

assert.equal(normalizeJobImportIntent('header_stub'), 'header_stub');
assert.equal(normalizeJobImportIntent('full'), 'full');
assert.equal(normalizeJobImportIntent(undefined), 'full');
assert.equal(normalizeJobImportIntent(''), 'full');
assert.equal(normalizeJobImportIntent('garbage'), 'full');
assert.equal(NO_PARTS_PLACEHOLDER_PART_NUMBER, '__NO_PARTS__');

assert.equal(shouldUseHeaderStubImportPath('tf_material_picksheet_v1', 0), true);
assert.equal(shouldUseHeaderStubImportPath('tf_material_picksheet_v1', 1), false);
assert.equal(shouldUseHeaderStubImportPath('unknown', 0), false);

console.log('test-job-import-header-stub-gates: ok');
