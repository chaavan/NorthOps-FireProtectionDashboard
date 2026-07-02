const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const testRun = path.join(root, '.test-run');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const rel = request.slice(2);
    const compiled = path.join(testRun, rel + '.js');
    if (fs.existsSync(compiled)) {
      request = compiled;
    } else {
      request = path.join(root, rel);
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require('../.test-run/scripts/test-vendor-price-duplicate-logic.js');
require('../.test-run/scripts/test-vendor-price-etna-parser.js');
require('../.test-run/scripts/test-description-part-number.js');
