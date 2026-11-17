const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, '.qg-report.json');
const skipBuild = process.argv.includes('--skip-build');

const GATES = [
  {
    id: 'tokens',
    label: 'UX Spec & Token Pipeline Gate',
    cmd: 'npm',
    args: ['run', 'qg:tokens'],
    remediation: 'Run `npm run tokens:css`, ensure globals.css uses only --s-*/--c-* and square surfaces, and keep dashboard-design-system.html in sync.',
  },
  {
    id: 'typecheck',
    label: 'TypeScript Strict Check Gate',
    cmd: 'npm',
    args: ['run', 'qg:typecheck'],
    remediation: 'Fix TypeScript errors reported by `npx tsc --noEmit`.',
  },
  {
    id: 'unit-and-specs',
    label: 'Business Rules & UX Spec Tests Gate',
    cmd: 'npm',
    args: ['run', 'qg:unit'],
    remediation: 'Inspect failing BR-* / UX-* assertions in tests/ and fix the underlying implementation.',
  },
  {
    id: 'api-integration',
    label: 'API Integration Tests Gate',
    cmd: 'npm',
    args: ['run', 'qg:api'],
    remediation: 'Check src/app/api/** route handlers and tests/api-integration.test.ts.',
  },
  {
    id: 'security',
    label: 'Static Security & Headers Gate',
    cmd: 'npm',
    args: ['run', 'qg:security'],
    remediation: 'Resolve SEC-* findings in src/ or next.config.js.',
  },
  {
    id: 'regressions',
    label: 'Production Feedback Regression Gate',
    cmd: 'npm',
    args: ['run', 'qg:regression'],
    remediation: 'Inspect failing REG-* regression cases in tests/regressions.test.ts.',
  },
];

if (!skipBuild) {
  GATES.push({
    id: 'build',
    label: 'Next.js Production Build Gate',
    cmd: 'npm',
    args: ['run', 'build'],
    remediation: 'Fix Next.js compilation, bundling, or App Router build errors.',
  });
}

const results = [];
let overallPassed = true;
const startedAt = new Date().toISOString();

console.log('=== RxFlow Automated Quality Gates ===\n');

for (const gate of GATES) {
  const gateStart = Date.now();
  console.log(`-> [${gate.id}] ${gate.label}`);
  const run = spawnSync(gate.cmd, gate.args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: gate.id === 'build' ? 'production' : 'test' },
  });

  const durationMs = Date.now() - gateStart;
  const passed = run.status === 0;
  if (!passed) overallPassed = false;

  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);

  results.push({
    id: gate.id,
    label: gate.label,
    status: passed ? 'passed' : 'failed',
    exitCode: run.status ?? 1,
    durationMs,
    remediation: passed ? null : gate.remediation,
  });

  if (!passed) {
    console.error(`\n[QG:${gate.id}] FAILED in ${durationMs}ms`);
    console.error(`  Remediation: ${gate.remediation}\n`);
  } else {
    console.log(`[QG:${gate.id}] PASSED (${durationMs}ms)\n`);
  }
}

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  overallStatus: overallPassed ? 'passed' : 'failed',
  failedGates: results.filter(r => r.status === 'failed').map(r => r.id),
  gates: results,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

console.log(`=== Quality Gate Summary: ${report.overallStatus.toUpperCase()} ===`);
console.log(`Report written to ${path.relative(ROOT, REPORT_PATH)}`);

if (!overallPassed) {
  console.error(`Failed gates: ${report.failedGates.join(', ')}`);
  process.exit(1);
}
