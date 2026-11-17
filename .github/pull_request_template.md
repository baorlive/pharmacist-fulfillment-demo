## Summary

Describe the behavior change, linked spec (`BR-*` / `UX-*`) or incident (`REG-*`).

## Automated Quality Gates

- [ ] `npm run qg` passed locally (tokens/UX, typecheck, unit/spec tests, API integration, security scan, regressions, build)
- [ ] `npm run qg:risk` reviewed for high-risk domains

## High-Risk Stage Gate Classification

Check any domain touched by this PR (requires human sign-off before merge/deploy):

- [ ] Authentication / session / access control
- [ ] Payment logic (`verify-pay`, `payStatus`, totals, `VERIFY_PAY_LOCK_MS`)
- [ ] Database / schema migrations
- [ ] Security-sensitive operations (`next.config.js`, `layout.tsx`, dependencies, CI/Quality Gate scripts)
- [ ] None of the above (low-risk UI / docs / non-critical refactor)

## Production Feedback Link (if fixing an incident)

- Telemetry code / Incident ID: `N/A`
- Added regression test (`REG-*`): `N/A`
