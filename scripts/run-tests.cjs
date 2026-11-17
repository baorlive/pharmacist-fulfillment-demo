const fs = require('node:fs');
const path = require('node:path');
const { registerTsLoader, ROOT } = require('./ts-loader.cjs');

registerTsLoader();

const requestedFiles = process.argv.slice(2);
const testsDir = path.join(ROOT, 'tests');

const files = requestedFiles.length
  ? requestedFiles.map(file => path.resolve(ROOT, file))
  : fs
      .readdirSync(testsDir)
      .filter(name => name.endsWith('.test.ts'))
      .sort()
      .map(name => path.join(testsDir, name));

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

for (const file of files) {
  require(file);
}
