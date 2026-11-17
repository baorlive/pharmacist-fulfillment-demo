# AGENTS.md

Working guide for coding agents and maintainers in **Pharmacist Fulfillment** (**RxFlow Orders**).

## Project At A Glance

RxFlow Orders is a Next.js 14 App Router pharmacy-order operations dashboard for receiving, verifying, packing, and dispatching medication orders.

- **Stack**: Next.js 14 (App Router), React 18, TypeScript, local `useReducer` store (`src/store/orderStore.ts`), three-layer CSS custom property pipeline (`src/lib/tokens/*` -> `src/app/tokens/*.css`), and Next.js API routes (`src/app/api/*`).
- **Design Catalog**: [`dashboard-design-system.html`](dashboard-design-system.html) mirrors the app's tokens and component patterns. Follow [`catalog-sync.md`](catalog-sync.md) when syncing changes between app and catalog.

## Runtime & Order Workflow

The single-page UI mounts [`src/components/Dashboard.tsx`](src/components/Dashboard.tsx) from [`src/app/page.tsx`](src/app/page.tsx). `Dashboard` owns the 1-second `TICK_TIMERS` interval, simulated incoming-order loop, simulated barcode scan loop, toast timers, and modal wiring.

Order lifecycle flow (`src/lib/types.ts`, `src/lib/utils.ts`, `src/store/orderStore.ts`):

```text
verify-pay -> accept -> review -> preparing -> ready -> deliver/handoff
deliver -> transit -> delivered-hold -> done
handoff -> delivered-hold -> done
```

Key invariants and timing constants (`src/lib/utils.ts`):

- `VERIFY_PAY_LOCK_MS` (`10s`): Unpaid orders (`verify-pay`) are locked for 10s before confirmation.
- `MAIN_ACTION_LOCK_MS` (`1.5s`): Guard against rapid repeated `accept` / `handoff` / `deliver` clicks.
- `accept` -> opens barcode packing (`review` action); confirming full scan moves the order to `ready` (`deliver` for courier, `handoff` for pickup) once all item expiry dates are filled (`isExpiryFulfilledForReady`).
- `DELIVERING_ETA_MS` (`30s`): `delivering` (`transit`) auto-transitions to `delivered-hold`.
- `COMPLETE_AUTO_MS` (`30m`): `delivered-hold` auto-completes to `done`.
- `SHIPPER_ARRIVAL_MS` (`2m`) and `PACKING_ETA_MS` (`2m`): UI display countdowns.
- Always call `normalizeOrderFlow()` after manual order mutations where status/phase/actionType could drift, and emit PII-free telemetry via `reportInvariantViolation()` (`src/lib/telemetry.ts`) rather than silently swallowing invalid states.

## UI & Design System Hard Gates

RxFlow is a square, clinical, dense operational workbench. Violating any rule below is treated as a defect (`npm run qg:tokens` / `npm run qg:unit` enforce them):

1. **Square surfaces only**: No visible `border-radius` on buttons, cards, modals, rows, chips, tabs, inputs, badges, dropdowns, scrollbars, or toasts (the logo dot is the sole circular exception). Use `var(--s-radius-none)` only to neutralize inherited radius.
2. **Two fonts only**: `Plus Jakarta Sans` (`var(--s-font-sans)`) for UI text; `DM Sans` (`var(--s-font-numeric)`) for order numbers, prices, counts, timestamps, and scan codes.
3. **Strict 3-layer token pipeline**:
   `src/lib/tokens/foundation.ts` (`--f-*`) -> `semantic.ts` (`--s-*`, refs `--f-*`) -> `component.ts` (`--c-*`, refs `--s-*`) -> `scripts/render-token-css.cjs` -> `src/app/tokens/*.css` -> `src/app/globals.css`.
   - Never hand-edit `src/app/tokens/*.css`; run `npm run tokens:css`.
   - Component CSS in `src/app/globals.css` must consume only `--s-*` or `--c-*` (never `--f-*`).
   - Do not use raw colors, shadows, font stacks, spacing (`gap`/`padding`/`margin`), sizing, motion, opacity, or z-index in component CSS (only allowed exceptions: `1px` borders, `2px` active indicators matching existing selectors, viewport units, percentages, and SVG `data:` URI internals).
4. **Sizing hierarchy**: `badge < pill < compact control < primary control`. Never use control-height tokens for badges; keep interactive controls accessible (`hover`, `active`, `disabled`, `:focus-visible`, ARIA attributes, and text/icon paired with status colors).
5. **Catalog parity & React integrity**: Mirror token/component CSS changes in `dashboard-design-system.html` per [`catalog-sync.md`](catalog-sync.md), and never replace live React components with static catalog markup.

## Verification & Quality Gates

Before finishing any change, run from the repository root:

```bash
npm run qg       # Runs tokens/UX, tsc, BR/UX unit specs, API integration, security scan, regressions, and next build
npm run qg:risk  # Classifies changed files for high-risk domain sign-off
```

- If any gate fails, inspect `.qg-report.json` (`failedGates`) and the failing `BR-*` / `UX-*` / `API-*` / `SEC-*` / `REG-*` ID, fix the root cause in source files (never weaken or bypass a gate), and re-run `npm run qg`.
- See [`docs/quality-gates.md`](docs/quality-gates.md) for the full specification matrix and regression scaffolding (`npm run qg:new-regression -- --id REG-XXX --title "..."`).
