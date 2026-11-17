const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGRESSIONS_FILE = path.join(ROOT, 'tests/regressions.test.ts');

function parseArgs(argv) {
  let id = '';
  let title = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id' && argv[i + 1]) id = argv[++i].trim();
    else if (argv[i] === '--title' && argv[i + 1]) title = argv[++i].trim();
  }
  return { id, title };
}

const { id, title } = parseArgs(process.argv.slice(2));
if (!id || !title || !/^REG-\d{3,}$/.test(id)) {
  console.error('Usage: npm run qg:new-regression -- --id REG-006 --title "Short description of production failure"');
  process.exit(1);
}

const existing = fs.readFileSync(REGRESSIONS_FILE, 'utf8');
if (existing.includes(id)) {
  console.error(`Regression ${id} already exists in tests/regressions.test.ts`);
  process.exit(1);
}

const safeTitle = title.replace(/'/g, "\\'");
const snippet = `
test('${id}: ${safeTitle}', () => {
  // TODO: Encode the exact production failure trigger and expected invariant assertion.
  assert.fail('${id} scaffolded — implement failure reproduction and fix before merging');
});
`;

fs.appendFileSync(REGRESSIONS_FILE, snippet);
console.log(`Added ${id} scaffold to tests/regressions.test.ts.`);
console.log('Next: reproduce the production bug in this test (verify it fails), fix src/, and run `npm run qg`.');
