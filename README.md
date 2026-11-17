# Pharmacist Fulfillment

<p align="center">
  <img src="public/readme/getnow-preview-thumbnail.png" alt="RxFlow Orders preview thumbnail" />
</p>

<p align="center">
  <a href="https://rxflow-orders.vercel.app/"><strong>Live Preview</strong></a>
</p>

Pharmacist Fulfillment is a Next.js 14 pharmacy-order operations demo. Inside the UI it is branded as **RxFlow Orders**: a dense split-pane dashboard for receiving, verifying, packing, and dispatching medication orders with a strict token-driven design system and automated Quality Gates.

## Highlights

- Split-view workbench with an order queue (`ListPanel`) on the left and a tabbed workflow detail view (`DetailPanel`) on the right
- 9 seeded demo orders in [`src/lib/data.ts`](src/lib/data.ts) plus an incoming-order simulation loop cloning templates from `RX-001`, `RX-002`, and `RX-008`
- Randomized barcode packing modal ([`src/components/modals/BarcodePopup.tsx`](src/components/modals/BarcodePopup.tsx)) with item expiry gating before an order can move to pickup or delivery
- Payment-verification lock (`10s`), courier transit countdown (`30s`), and delivered-hold auto-completion (`30m`) timers
- App Router API routes for service health/telemetry ([`src/app/api/health/route.ts`](src/app/api/health/route.ts)) and transition validation ([`src/app/api/orders/validate/route.ts`](src/app/api/orders/validate/route.ts))
- Strict three-layer design-token pipeline authored in TypeScript and rendered to generated CSS variables
- Automated Quality Gates pipeline (`npm run qg`) covering token/UX rules, TypeScript, business-rule/API/regression tests, static security scans, and production build

## Stack

- Next.js 14 App Router & React 18
- TypeScript (`strict` mode)
- Local `useReducer` store in [`src/store/orderStore.ts`](src/store/orderStore.ts)
- CSS custom properties generated from token maps in [`src/lib/tokens`](src/lib/tokens)
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader: false`) in [`next.config.js`](next.config.js)
- Vercel Analytics and optional env-gated Microsoft Clarity (`NEXT_PUBLIC_CLARITY_ID`) in [`src/app/layout.tsx`](src/app/layout.tsx)
- PII-free runtime invariant telemetry (`NEXT_PUBLIC_TELEMETRY_ENDPOINT`) in [`src/lib/telemetry.ts`](src/lib/telemetry.ts)
- CI & Quality Gates in [`scripts/`](scripts), [`tests/`](tests), and [`.github/workflows/quality-gates.yml`](.github/workflows/quality-gates.yml)

## Project Structure

```text
.
├── .env.example                   # Optional analytics/telemetry environment variables
├── .github/
│   ├── CODEOWNERS
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   └── workflows/quality-gates.yml
├── AGENTS.md                      # Architecture, UI design-system rules, and Quality Gate guide
├── LICENSE.md
├── catalog-sync.md                # Selector-sync checklist for token/catalog workflows
├── docs/
│   ├── barcode-scanning-ux-pattern.md
│   └── quality-gates.md
├── next.config.js
├── public/
│   ├── getnow.svg
│   └── readme/
├── scripts/
│   ├── render-token-css.cjs       # Generates src/app/tokens/*.css from TS token maps
│   ├── qg-*.cjs                   # Automated Quality Gate runners & risk classifier
│   ├── run-tests.cjs
│   ├── new-regression.cjs
│   └── ts-loader.cjs
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/route.ts
│   │   │   └── orders/validate/route.ts
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── tokens/                # Generated CSS variable layers
│   ├── components/
│   │   ├── Dashboard.tsx
│   │   ├── detail/
│   │   ├── layout/
│   │   ├── list/
│   │   ├── modals/
│   │   └── ui/
│   ├── lib/
│   │   ├── data.ts
│   │   ├── generateTokenCss.ts
│   │   ├── telemetry.ts
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   └── tokens/
│   └── store/
│       └── orderStore.ts
└── tests/
    ├── api-integration.test.ts
    ├── business-rules.test.ts
    ├── regressions.test.ts
    └── ux-specs.test.ts
```

## Runtime Architecture

The app renders a single page from [`src/app/page.tsx`](src/app/page.tsx), which mounts [`src/components/Dashboard.tsx`](src/components/Dashboard.tsx). `Dashboard` owns the app-level side effects:

- a 1-second `TICK_TIMERS` interval for delivery, hold, and verification countdowns
- the repeating incoming-order demo loop (toggled from `Topbar`)
- the simulated barcode scan loop (`START_BARCODE_SCAN` / `COMPLETE_BARCODE_SCAN`)
- toast enter/leave timing

Application state lives in [`src/store/orderStore.ts`](src/store/orderStore.ts) via `useAppStore()` (`initialState`, `reducer`). It manages orders, selection, filters/search, buyer-pharmacy messaging, reject/cancel confirmation, prescription preview, incoming-order popups, barcode scan state, and action locks (`VERIFY_PAY_LOCK_MS`, `MAIN_ACTION_LOCK_MS`). Invalid transitions and missing-entity/expiry blocks emit PII-free events via `reportInvariantViolation()` in [`src/lib/telemetry.ts`](src/lib/telemetry.ts).

## Order Workflow

Order state is normalized via `normalizeOrderFlow()`, `canonicalPhase()`, and `canonicalActionType()` in [`src/lib/utils.ts`](src/lib/utils.ts):

```text
verify-pay -> accept -> review -> preparing -> ready -> deliver/handoff
deliver -> transit -> delivered-hold -> done
handoff -> delivered-hold -> done
```

Key workflow rules:

- `verify-pay` is locked for `10s` (`VERIFY_PAY_LOCK_MS`) before an unpaid order can be confirmed.
- `accept` opens the barcode packing modal and places the order in the passive `review` action until scanning runs or closes.
- Confirming a full barcode scan sets the order to `ready` (`deliver` for `courier`, `handoff` for `pickup`), gated on all items having an expiry date (`isExpiryFulfilledForReady`).
- Courier deliveries auto-transition from `transit` (`delivering`) to `delivered-hold` after `30s` (`DELIVERING_ETA_MS`).
- Delivered orders auto-complete to `completed` / `done` after `30m` (`COMPLETE_AUTO_MS`) if no issue is reported.
- Rapid repeated `accept` / `handoff` / `deliver` actions within `1.5s` (`MAIN_ACTION_LOCK_MS`) are ignored.
- Legacy `cod` orders normalize to `paid` (`VNPay`), and `rxStatus === 'rejected'` normalizes to terminal `completed` / `done`.

## API Routes

- `GET /api/health` ([`src/app/api/health/route.ts`](src/app/api/health/route.ts)): returns service status (`ok`), `seedOrders` count, and `recentViolationsCount` from the telemetry buffer.
- `POST /api/orders/validate` ([`src/app/api/orders/validate/route.ts`](src/app/api/orders/validate/route.ts)): validates transition requests (`verify-pay`, `accept`, `ready`, `deliver`, `handoff`, `reject`, `cancel`) against workflow invariants, lock windows, expiry requirements, and reject reasons.

## Design System

The styling model uses a strict three-layer token pipeline:

```text
src/lib/tokens/foundation.ts (--f-*)
  -> src/lib/tokens/semantic.ts (--s-*)
  -> src/lib/tokens/component.ts (--c-*)
  -> src/lib/generateTokenCss.ts
  -> scripts/render-token-css.cjs
  -> src/app/tokens/{foundation,semantic,component}.css
  -> src/app/globals.css
```

Enforced by [`scripts/qg-design-system.cjs`](scripts/qg-design-system.cjs) and [`tests/ux-specs.test.ts`](tests/ux-specs.test.ts):

- **Square surfaces only**: no visible `border-radius` except `.logo-dot`.
- **Two fonts only**: `Plus Jakarta Sans` (`--s-font-sans`) for UI text and `DM Sans` (`--s-font-numeric`) for numbers, IDs, prices, and timestamps.
- **Strict layer boundaries**: `globals.css` consumes only `--s-*` and `--c-*` (never `--f-*`), and generated files in `src/app/tokens/` must match TypeScript token sources byte-for-byte.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional environment variables (see [`.env.example`](.env.example)):

- `NEXT_PUBLIC_CLARITY_ID`: enables Microsoft Clarity script injection via `next/script` in [`src/app/layout.tsx`](src/app/layout.tsx).
- `NEXT_PUBLIC_TELEMETRY_ENDPOINT`: optional beacon URL for `reportInvariantViolation()` in [`src/lib/telemetry.ts`](src/lib/telemetry.ts).

Production preview: [https://rxflow-orders.vercel.app/](https://rxflow-orders.vercel.app/)

## Scripts

- `npm run tokens:css` — regenerates `src/app/tokens/foundation.css`, `semantic.css`, and `component.css`
- `npm run dev` — regenerates token CSS and starts the Next.js dev server
- `npm run build` — regenerates token CSS and runs the production build
- `npm run start` — regenerates token CSS and starts the production server
- `npm run qg` — runs the full Automated Quality Gates pipeline (writes `.qg-report.json`)
- `npm run qg:tokens` — verifies token CSS sync, layer boundaries, square surfaces, and font rules (`UX-01..UX-05`)
- `npm run qg:typecheck` — runs `tsc --noEmit`
- `npm run qg:unit` — runs [`tests/business-rules.test.ts`](tests/business-rules.test.ts) (`BR-01..BR-09`) and [`tests/ux-specs.test.ts`](tests/ux-specs.test.ts) (`UX-01..UX-05`)
- `npm run qg:api` — runs [`tests/api-integration.test.ts`](tests/api-integration.test.ts) (`API-01..API-07`)
- `npm run qg:security` — runs [`scripts/qg-security.cjs`](scripts/qg-security.cjs) (`SEC-01..SEC-05`)
- `npm run qg:regression` — runs [`tests/regressions.test.ts`](tests/regressions.test.ts) (`REG-001..REG-005`)
- `npm run qg:risk` — classifies changed files for high-risk domain sign-off
- `npm run qg:new-regression -- --id REG-XXX --title "..."` — scaffolds a new regression test entry

## Verification & Quality Gates

```bash
npm run qg
npm run qg:risk
```

See [`docs/quality-gates.md`](docs/quality-gates.md) for the full specification matrix, agent self-correction loop, and high-risk stage gates.

## License

This template is licensed for **personal use only**.

- Personal learning, private study, and non-commercial experimentation are allowed.
- Commercial use, redistribution, resale, relicensing, and publishing this as a template or starter are not allowed without explicit written permission.

See [`LICENSE.md`](LICENSE.md) for the full terms.

## Reference Docs

- [`AGENTS.md`](AGENTS.md): architecture, UI design-system rules, and Quality Gate guide
- [`docs/quality-gates.md`](docs/quality-gates.md): automated Quality Gates specification, risk stage gates, and regression loop
- [`catalog-sync.md`](catalog-sync.md): selector-sync workflow notes
- [`docs/barcode-scanning-ux-pattern.md`](docs/barcode-scanning-ux-pattern.md): notes on previous barcode interaction patterns
