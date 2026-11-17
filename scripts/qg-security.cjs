const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const findings = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function addFinding(id, file, line, message, remediation) {
  findings.push({
    id,
    file: path.relative(ROOT, file),
    line,
    message,
    remediation,
  });
}

const codeFiles = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'scripts')),
  ...walk(path.join(ROOT, 'tests')),
].filter(file => /\.(ts|tsx|js|cjs|mjs)$/.test(file));

const secretPatterns = [
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub PAT', regex: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI/API secret key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

for (const file of codeFiles) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const isSrc = rel.startsWith('src' + path.sep);
  const isSelf = rel === path.join('scripts', 'qg-security.cjs');

  lines.forEach((lineText, index) => {
    const lineNum = index + 1;

    if (isSrc) {
      if (/\beval\s*\(/.test(lineText) || /\bnew\s+Function\s*\(/.test(lineText)) {
        addFinding('SEC-01', file, lineNum, 'Dynamic code evaluation (eval / new Function) is forbidden in src/', 'Replace dynamic code execution with static typed logic.');
      }
      if (/dangerouslySetInnerHTML/.test(lineText) || /\.innerHTML\s*=/.test(lineText)) {
        addFinding('SEC-02', file, lineNum, 'Raw HTML injection surface (dangerouslySetInnerHTML / innerHTML) is forbidden', 'Render JSX or safe next/script elements without raw HTML injection.');
      }
      if (/http:\/\/(?!localhost|127\.0\.0\.1)/.test(lineText)) {
        addFinding('SEC-04', file, lineNum, 'Insecure cleartext http:// URL in src/', 'Use https:// for external endpoints.');
      }
      if (/require\(['"]node:child_process['"]\)|from ['"]child_process['"]/.test(lineText)) {
        addFinding('SEC-01', file, lineNum, 'child_process usage in app src/ is forbidden', 'Remove shell execution from Next.js runtime code.');
      }
    }

    if (!isSelf) {
      for (const pattern of secretPatterns) {
        if (pattern.regex.test(lineText)) {
          addFinding('SEC-03', file, lineNum, `Potential hardcoded ${pattern.name} detected`, 'Move credentials into environment variables and rotate the exposed secret.');
        }
      }
    }
  });
}

// SEC-05: Security headers in next.config.js
const nextConfigPath = path.join(ROOT, 'next.config.js');
if (!fs.existsSync(nextConfigPath)) {
  addFinding('SEC-05', nextConfigPath, 1, 'Missing next.config.js', 'Restore next.config.js with security headers.');
} else {
  const nextConfigText = fs.readFileSync(nextConfigPath, 'utf8');
  const requiredConfigTokens = ['poweredByHeader: false', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy'];
  for (const token of requiredConfigTokens) {
    if (!nextConfigText.includes(token)) {
      addFinding('SEC-05', nextConfigPath, 1, `Missing security hardening directive "${token}" in next.config.js`, 'Add required security headers and disable X-Powered-By in next.config.js.');
    }
  }
}

if (findings.length > 0) {
  console.error(`\n[QG:security] FAILED (${findings.length} finding${findings.length > 1 ? 's' : ''}):`);
  for (const f of findings) {
    console.error(`  - [${f.id}] ${f.file}:${f.line} — ${f.message}`);
    console.error(`    Fix: ${f.remediation}`);
  }
  process.exit(1);
}

console.log('[QG:security] PASSED (SEC-01..SEC-05 verified: no unsafe eval/XSS sinks, no hardcoded secrets, no cleartext external URLs, security headers enforced).');
