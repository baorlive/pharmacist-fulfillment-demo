# Automated Quality Gates (QGs)

RxFlow Orders replaces ad-hoc manual code review with a continuous verification pipeline across five pillars.

## 1. Define What Correct Means

Acceptance criteria, UX rules, and business invariants are encoded as executable test IDs:

| Suite | Scope | Source of Truth |
|---|---|---|
| `BR-01..BR-09` (`tests/business-rules.test.ts`) | Payment verification lock (`VERIFY_PAY_LOCK_MS`), barcode scan gating, expiry gate, courier/pickup branching, hold/auto-complete timers, reject reasons, double-click lock, message guards | `AGENTS.md`, `src/store/orderStore.ts`, `src/lib/utils.ts` |
| `UX-01..UX-05` (`tests/ux-specs.test.ts` + `scripts/qg-design-system.cjs`) | Square surfaces only, strict 3-layer token boundaries (`foundation -> semantic -> component -> globals.css`), generated CSS sync, 2-font limit, sizing hierarchy, catalog parity, ARIA attributes | `AGENTS.md`, `catalog-sync.md` |
| `API-01..API-07` (`tests/api-integration.test.ts`) | `GET /api/health` contract and `POST /api/orders/validate` state/payment/expiry/reject validation | `src/app/api/**` |
| `SEC-01..SEC-05` (`scripts/qg-security.cjs`) | No `eval`/`new Function`, no `dangerouslySetInnerHTML`/`innerHTML`, no hardcoded secrets, HTTPS external links, `next.config.js` security headers | `next.config.js`, `src/` |
| `REG-001..REG-005` (`tests/regressions.test.ts`) | Permanent regression checks generated from production behavior and codebase audits | `src/lib/telemetry.ts` |

## 2. Validate Automatically in CI/CD

Run the full local gate pipeline before committing:

```bash
npm run qg
```

Individual gates:

- `npm run qg:tokens` — token CSS parity & UX design-system guardrails
- `npm run qg:typecheck` — strict TypeScript check (`tsc --noEmit`)
- `npm run qg:unit` — business rules (`BR-*`) and UX specs (`UX-*`)
- `npm run qg:api` — Next.js App Router API integration tests (`API-*`)
- `npm run qg:security` — static security & header checks (`SEC-*`)
- `npm run qg:regression` — production feedback regressions (`REG-*`)
- `npm run build` — production Next.js build

GitHub Actions (`.github/workflows/quality-gates.yml`) runs `npm run qg` (failing the pipeline if any required gate fails) and runs an advisory `npm audit --audit-level=high` scan on every PR and push to `main`.

## 3. Drive Agent Self-Correction

`npm run qg` emits a machine-readable report at `.qg-report.json` containing each gate's `status`, `durationMs`, and `remediation` hint.

Agent loop when a gate fails:
1. Inspect `.qg-report.json` (`failedGates`) and the failing `BR-*` / `UX-*` / `API-*` / `SEC-*` / `REG-*` ID.
2. Investigate and fix the root cause in source files — never bypass, relax, or delete a failing gate.
3. Re-run `npm run qg` until `overallStatus === "passed"`.

## 4. Enforce Human Sign-Offs for High-Risk Changes

High-risk domains require explicit human sign-off before merge or production deployment:

- **Authentication & Access Control** (`auth`, `session`, `middleware`, `permissions`)
- **Payment Logic** (`verify-pay`, `payStatus`, `VERIFY_PAY_LOCK_MS`, totals, `src/app/api/orders/validate/route.ts`)
- **Database Migrations** (`migrations/`, `prisma/`, `drizzle/`, `*.sql`)
- **Security & Gate Integrity** (`next.config.js`, `src/app/layout.tsx`, `package.json`, `.github/`, `scripts/qg-*.cjs`)

Mechanisms:
- Local & PR risk classifier: `npm run qg:risk` (`scripts/qg-risk-gate.cjs`)
- Required code owners: `.github/CODEOWNERS`
- Mandatory PR risk declaration: `.github/pull_request_template.md`
- CI PR classification job: `risk-assessment` job in `.github/workflows/quality-gates.yml`

## 5. Close the Production Feedback Loop

1. Runtime invariant violations are captured PII-free via `src/lib/telemetry.ts` (`reportInvariantViolation`) and surfaced via `GET /api/health`.
2. Production incidents are filed using `.github/ISSUE_TEMPLATE/production-incident.yml`.
3. Scaffold a permanent regression gate for any production failure:

```bash
npm run qg:new-regression -- --id REG-006 --title "Short description of production failure"
```

4. Reproduce the failure in `tests/regressions.test.ts`, fix the source bug, and verify `npm run qg` passes.
