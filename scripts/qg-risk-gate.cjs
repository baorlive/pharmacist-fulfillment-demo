const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const HIGH_RISK_RULES = [
  {
    domain: 'payment-logic',
    owner: '@baorlive',
    reason: 'Touches payment verification lock, payment status normalization, totals, or order transition validation.',
    pathPatterns: [
      /^src\/store\/orderStore\.ts$/,
      /^src\/lib\/utils\.ts$/,
      /^src\/app\/api\/orders\/validate\/route\.ts$/,
    ],
    diffPatterns: [
      /verify-pay/i,
      /payStatus/i,
      /VERIFY_PAY_LOCK_MS/,
      /deliveryFee/,
    ],
  },
  {
    domain: 'authentication-and-access',
    owner: '@baorlive',
    reason: 'Touches authentication, session, middleware, or access control logic.',
    pathPatterns: [
      /(^|\/)(auth|session|login|middleware|permissions?)/i,
    ],
    diffPatterns: [
      /\b(jwt|oauth|session|password|csrf)\b/i,
    ],
  },
  {
    domain: 'database-migrations',
    owner: '@baorlive',
    reason: 'Touches schema definitions or database migrations.',
    pathPatterns: [
      /(^|\/)(migrations?|prisma|drizzle)\//i,
      /\.sql$/i,
    ],
    diffPatterns: [],
  },
  {
    domain: 'security-and-quality-gates',
    owner: '@baorlive',
    reason: 'Touches Next.js security headers, root layout scripts, dependencies, CI workflows, or Quality Gate scripts.',
    pathPatterns: [
      /^next\.config\.js$/,
      /^src\/app\/layout\.tsx$/,
      /^package(-lock)?\.json$/,
      /^\.github\//,
      /^scripts\/qg-.*\.cjs$/,
    ],
    diffPatterns: [],
  },
];

function parseArgs(argv) {
  const args = { base: null, files: [], json: false, enforce: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' && argv[i + 1]) args.base = argv[++i];
    else if (a === '--files' && argv[i + 1]) args.files.push(...argv[++i].split(',').filter(Boolean));
    else if (a === '--json') args.json = true;
    else if (a === '--enforce') args.enforce = true;
  }
  return args;
}

function getChangedFiles(base) {
  try {
    if (base) {
      const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' });
      return out.split('\n').map(s => s.trim()).filter(Boolean);
    }
    const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
    return Array.from(new Set([
      ...tracked.split('\n'),
      ...untracked.split('\n'),
    ].map(s => s.trim()).filter(Boolean)));
  } catch {
    return [];
  }
}

function getDiffText(base, file) {
  try {
    const args = base ? ['diff', `${base}...HEAD`, '--', file] : ['diff', 'HEAD', '--', file];
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
}

function classifyChanges(files, base) {
  const matchedDomains = new Map();

  for (const file of files) {
    const diffText = getDiffText(base, file);
    for (const rule of HIGH_RISK_RULES) {
      const pathHit = rule.pathPatterns.some(rx => rx.test(file));
      const diffHit = diffText ? rule.diffPatterns.some(rx => rx.test(diffText)) : false;
      if (pathHit || diffHit) {
        if (!matchedDomains.has(rule.domain)) {
          matchedDomains.set(rule.domain, {
            domain: rule.domain,
            owner: rule.owner,
            reason: rule.reason,
            files: [],
          });
        }
        matchedDomains.get(rule.domain).files.push(file);
      }
    }
  }

  const hits = Array.from(matchedDomains.values());
  return {
    riskLevel: hits.length > 0 ? 'HIGH' : 'LOW',
    requiresHumanSignOff: hits.length > 0,
    changedFilesCount: files.length,
    matchedDomains: hits,
  };
}

const args = parseArgs(process.argv.slice(2));
const files = args.files.length ? args.files : getChangedFiles(args.base);
const assessment = classifyChanges(files, args.base);

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `risk_level=${assessment.riskLevel}`,
    `requires_human_signoff=${assessment.requiresHumanSignOff}`,
    `domains=${assessment.matchedDomains.map(d => d.domain).join(',')}`,
  ];
  fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

if (args.json) {
  console.log(JSON.stringify(assessment, null, 2));
} else {
  console.log(`[QG:risk-gate] Risk Level: ${assessment.riskLevel} (${assessment.changedFilesCount} changed file(s) inspected)`);
  if (assessment.requiresHumanSignOff) {
    console.log('  Human sign-off required before merge/deploy:');
    for (const hit of assessment.matchedDomains) {
      console.log(`  - ${hit.domain} (${hit.owner}): ${hit.reason}`);
      console.log(`    Files: ${hit.files.join(', ')}`);
    }
  } else {
    console.log('  No high-risk domains touched; automated quality gates suffice.');
  }
}

if (args.enforce && assessment.requiresHumanSignOff && process.env.HUMAN_SIGNOFF_APPROVED !== 'true') {
  console.error('[QG:risk-gate] BLOCKED: High-risk change requires explicit human sign-off (HUMAN_SIGNOFF_APPROVED=true or GitHub Environment approval).');
  process.exit(1);
}
