const fs = require('node:fs');
const path = require('node:path');
const { registerTsLoader, ROOT } = require('./ts-loader.cjs');

registerTsLoader();

const {
  generateFoundationCss,
  generateSemanticCss,
  generateComponentCss,
} = require('../src/lib/generateTokenCss.ts');
const { foundation, foundationCssVars } = require('../src/lib/tokens/foundation.ts');
const { semanticCssVars } = require('../src/lib/tokens/semantic.ts');
const { componentCssVars } = require('../src/lib/tokens/component.ts');

const errors = [];

function fail(id, message, remediation) {
  errors.push({ id, message, remediation });
}

// UX-03: Generated token CSS files must match TypeScript token sources byte-for-byte.
const expectedLayers = [
  ['src/app/tokens/foundation.css', generateFoundationCss()],
  ['src/app/tokens/semantic.css', generateSemanticCss()],
  ['src/app/tokens/component.css', generateComponentCss()],
];

for (const [relPath, expected] of expectedLayers) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    fail('UX-03', `Missing generated token file: ${relPath}`, 'Run `npm run tokens:css` to regenerate token CSS.');
    continue;
  }
  const actual = fs.readFileSync(absPath, 'utf8');
  if (actual !== expected) {
    fail('UX-03', `Generated token CSS is out of sync: ${relPath}`, 'Run `npm run tokens:css` and commit the updated token CSS.');
  }
}

// UX-02: Strict 3-layer token boundaries.
for (const [name, value] of Object.entries(semanticCssVars)) {
  if (!name.startsWith('--s-')) {
    fail('UX-02', `Semantic token "${name}" must start with --s-`, 'Rename token in src/lib/tokens/semantic.ts.');
  }
  const refs = [...String(value).matchAll(/var\((--[^)]+)\)/g)].map(m => m[1]);
  if (refs.length === 0 || refs.some(ref => !ref.startsWith('--f-'))) {
    fail(
      'UX-02',
      `Semantic token "${name}: ${value}" must reference --f-* vars only`,
      'Update semanticCssVars in src/lib/tokens/semantic.ts to reference foundation --f-* tokens.',
    );
  }
}

for (const [name, value] of Object.entries(componentCssVars)) {
  if (!name.startsWith('--c-')) {
    fail('UX-02', `Component token "${name}" must start with --c-`, 'Rename token in src/lib/tokens/component.ts.');
  }
  const refs = [...String(value).matchAll(/var\((--[^)]+)\)/g)].map(m => m[1]);
  if (refs.some(ref => !ref.startsWith('--s-') && !ref.startsWith('--f-'))) {
    fail(
      'UX-02',
      `Component token "${name}: ${value}" contains disallowed var() reference`,
      'Reference only --s-* or --f-* in src/lib/tokens/component.ts.',
    );
  }
}

const globalsPath = path.join(ROOT, 'src/app/globals.css');
const globalsCss = fs.readFileSync(globalsPath, 'utf8');
const globalsLines = globalsCss.split('\n');

globalsLines.forEach((line, idx) => {
  if (/var\(--f-/.test(line)) {
    fail(
      'UX-02',
      `src/app/globals.css:${idx + 1} references foundation token (--f-*) directly`,
      'Replace --f-* with a semantic (--s-*) or component (--c-*) token.',
    );
  }

  // UX-01: Square surfaces only (no non-zero border-radius in app CSS except .logo-dot).
  if (/border-radius\s*:/.test(line) && !/\.logo-dot/.test(line)) {
    const allowed = /border-radius\s*:\s*(0|0px|var\(--s-radius-none\))\s*;/.test(line);
    if (!allowed) {
      fail(
        'UX-01',
        `src/app/globals.css:${idx + 1} introduces non-square border-radius: ${line.trim()}`,
        'Use square surfaces (remove border-radius or use var(--s-radius-none)).',
      );
    }
  }
});

// UX-01: Foundation radius tokens must stay 0px.
if (foundationCssVars['--f-r-none'] !== '0px') {
  fail('UX-01', '--f-r-none must equal 0px', 'Restore --f-r-none to 0px in src/lib/tokens/foundation.ts.');
}

// UX-04: Two fonts only.
const fontValues = Object.values(foundation.font?.family || {});
for (const fontValue of fontValues) {
  if (!String(fontValue).includes('Plus Jakarta Sans') && !String(fontValue).includes('DM Sans')) {
    fail(
      'UX-04',
      `Unexpected font family in foundation.font.family: ${fontValue}`,
      'Restrict typography to Plus Jakarta Sans and DM Sans.',
    );
  }
}

// UX-05: Catalog parity and ActionFooter instrumentation checks.
const catalogPath = path.join(ROOT, 'dashboard-design-system.html');
if (fs.existsSync(catalogPath)) {
  const catalogHtml = fs.readFileSync(catalogPath, 'utf8');
  const requiredSelectors = [
    '.order-row',
    '.main-action',
    '.barcode-popup',
    '.incoming-popup',
    '.reject-popup',
    '.prescription-popup',
  ];
  for (const selector of requiredSelectors) {
    if (!globalsCss.includes(selector) || !catalogHtml.includes(selector)) {
      fail(
        'UX-05',
        `Selector "${selector}" missing from app CSS or design catalog`,
        'Sync the selector across src/app/globals.css and dashboard-design-system.html.',
      );
    }
  }
}

const actionFooterPath = path.join(ROOT, 'src/components/detail/ActionFooter.tsx');
const actionFooterSrc = fs.readFileSync(actionFooterPath, 'utf8');
if (!actionFooterSrc.includes('data-action-type') || !actionFooterSrc.includes('data-order-status')) {
  fail(
    'UX-05',
    'ActionFooter must expose data-action-type and data-order-status attributes',
    'Restore data-action-type and data-order-status on #main-action-btn in ActionFooter.tsx.',
  );
}

if (errors.length > 0) {
  console.error(`\n[QG:design-system] FAILED (${errors.length} violation${errors.length > 1 ? 's' : ''}):`);
  for (const err of errors) {
    console.error(`  - [${err.id}] ${err.message}`);
    console.error(`    Fix: ${err.remediation}`);
  }
  process.exit(1);
}

console.log('[QG:design-system] PASSED (UX-01..UX-05 verified: tokens in sync, 3-layer boundary clean, square surfaces enforced, catalog parity intact).');
