import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatCountdown,
  itemSummaryPreview,
  stockStatusLabel,
  toOrderCode,
} from '@/lib/utils';
import { ORDERS_SEED } from '@/lib/data';
import { foundationCssVars } from '@/lib/tokens/foundation';
import { semanticCssVars } from '@/lib/tokens/semantic';
import { componentCssVars } from '@/lib/tokens/component';

const ROOT = process.cwd();

function resolveTokenPx(componentVar: keyof typeof componentCssVars): number {
  const cVal = String(componentCssVars[componentVar]);
  const sMatch = cVal.match(/^var\((--s-[^)]+)\)$/);
  const sVal = sMatch ? String((semanticCssVars as Record<string, string | number>)[sMatch[1]]) : cVal;
  const fMatch = sVal.match(/^var\((--f-[^)]+)\)$/);
  const fVal = fMatch ? String((foundationCssVars as Record<string, string | number>)[fMatch[1]]) : sVal;
  return Number.parseInt(fVal, 10);
}

test('UX-01: square surface tokens and zero-radius component styling', () => {
  assert.equal(semanticCssVars['--s-radius-none'], 'var(--f-r-none)');
  assert.equal(foundationCssVars['--f-r-none'], '0px');
  const globalsCss = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
  const nonZeroRadius = globalsCss
    .split('\n')
    .filter(line => /border-radius\s*:/.test(line) && !/\.logo-dot/.test(line))
    .filter(line => !/border-radius\s*:\s*(0|0px|var\(--s-radius-none\))\s*;/.test(line));
  assert.deepEqual(nonZeroRadius, []);
});

test('UX-02: sizing hierarchy invariant badge < pill < compact control < primary control', () => {
  const badge = resolveTokenPx('--c-label-height');
  const pill = resolveTokenPx('--c-pill-interactive-height');
  const compact = resolveTokenPx('--c-control-height-compact');
  const primary = resolveTokenPx('--c-control-height');

  assert.ok(badge < pill, `Expected badge (${badge}) < pill (${pill})`);
  assert.ok(pill < compact, `Expected pill (${pill}) < compact (${compact})`);
  assert.ok(compact < primary, `Expected compact (${compact}) < primary (${primary})`);
});

test('UX-03: list preview truncates long item lists cleanly with +N hidden count', () => {
  const largeOrder = ORDERS_SEED.find(o => o.id === 'RX-002')!;
  const preview = itemSummaryPreview(largeOrder);
  assert.ok(preview.items.length > 0);
  assert.ok(preview.hiddenCount > 0);
  assert.equal(preview.items.length + preview.hiddenCount, largeOrder.items.length);
});

test('UX-04: numeric display formatting helpers preserve pharmacy safety readability', () => {
  assert.equal(toOrderCode('RX-001'), 'ORD-1024');
  assert.equal(formatCountdown(90_000), '01:30');
  assert.equal(stockStatusLabel('in-stock'), 'In Stock');
  assert.equal(stockStatusLabel('out-of-stock'), 'Out of Stock');
  assert.equal(stockStatusLabel('need-check'), 'Need Check');
});

test('UX-05: interactive components preserve ARIA, dialog semantics, and testability attributes', () => {
  const topbar = fs.readFileSync(path.join(ROOT, 'src/components/layout/Topbar.tsx'), 'utf8');
  const incomingPopup = fs.readFileSync(path.join(ROOT, 'src/components/modals/IncomingPopup.tsx'), 'utf8');
  const actionFooter = fs.readFileSync(path.join(ROOT, 'src/components/detail/ActionFooter.tsx'), 'utf8');

  assert.match(topbar, /role="switch"/);
  assert.match(topbar, /aria-checked=/);
  assert.match(incomingPopup, /role="dialog"/);
  assert.match(incomingPopup, /aria-modal="true"/);
  assert.match(actionFooter, /data-action-type=/);
  assert.match(actionFooter, /data-order-status=/);
});
