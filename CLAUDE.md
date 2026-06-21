# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

This is a **single-file SPA** (`index.html`) — all HTML, CSS, and JavaScript live in one file. There is no build system, no package.json, no bundler. The app runs by opening `index.html` directly in a browser or serving it from any static HTTP server.

External dependencies are loaded from CDN:
- `@supabase/supabase-js@2` — backend client (auth + database)
- `papaparse@5.4.1` — CSV parsing for transaction imports

## Running the App

```bash
# Serve locally (any static server works):
npx serve .
# or
python3 -m http.server 8080
```

No compilation or install step needed.

## Supabase Configuration

The Supabase URL and publishable key are hardcoded at the top of `index.html` (lines 13–14). The key is safe to expose — data is protected by Row-Level Security (RLS) policies on all tables, restricting every row to `auth.uid() = user_id`.

## Database Schema

Tables in `supabase/schema.sql`:

| Table | Purpose |
|---|---|
| `transactions` | Bank bookings — `buchungsdatum`, `soll`/`haben`, `kategorie`, `bank`, `immo_id`, `kreditkarte`, `umbuchung` |
| `banks` | Bank accounts — `hat_portfolio`, `hat_kreditkarte`, `saldo_start`, `eigentuemer` (JSONB) |
| `portfolio` | ETF position snapshots — one row per position per date per bank |
| `immobilien` | Real estate properties — purchase data, mortgage, rent, tax model |
| `immo_schuld` | Debt history per property over time |
| `beteiligungen` | Equity stakes / private investments |
| `pensionsfonds` | Pension fund entries |
| `steuer_einstellungen` | Per-user tax settings (grenzsteuersatz, vorauszahlung) |

Migrations live in `supabase/migrations/`. Schema changes should be written as new migration files.

## Key JavaScript Patterns

**Global state** (top of `<script>`):
- `allRows` — all `transactions` rows, loaded on auth
- `portfolioRows` — all `portfolio` rows
- `activeTxBank` / `activePfBank` — which bank is selected in the sidebar submenu (`null` = overview)
- `banks` — bank list (populated by `loadBanks()`)

**Data flow**: On login → `loadData()`, `loadPortfolio()`, `loadBanks()`, `loadImmo()`, `loadBet()`, `loadPens()`, `loadSteuer()` all fire. Each stores rows in a global variable and calls its `render*()` function. The global date range filter (`filter-von` / `filter-bis`) is applied at render time via `dateInRange()` and `inRange()`.

**Navigation**: Four top-level rail sections (`finanzen`, `steuern`, `versicherung`, `simulator`) switch via `switchSection()`. Within a section, `showPage(pageId, title)` hides/shows `<section id="page-{pageId}">` elements.

**Number formatting**: German locale throughout.
- `euro(n)` — formats to `"1.234,56 €"`
- `fmtNum(n, dec)` — formats without currency symbol
- `numDE(v)` — parses German-formatted input back to a JS number
- `parseDate(v)` — accepts `"19.06.26"` or ISO format

**XSS**: All user content rendered into the DOM uses `esc(s)` for HTML entity escaping.

**Umbuchung (transfers between accounts)**: A transaction can be marked as `umbuchung: true` with an `umbuchung_partner` UUID linking to the counterpart transaction. Both sides are always updated together. Transfer transactions are excluded from income/expense totals.

## Tax Context

The app targets Italian tax law:
- **IRPEF** — income tax (23 % up to 28 000 €, 33 % up to 50 000 €, 43 % above)
- **Cedolare Secca** — 21 % flat tax on rental income (alternative to IRPEF for rentals)
- **IMU** — Italian municipal property tax
- **Kapitalertragsteuer** — 26 % capital gains / withholding tax on investment returns
- Pension fund contributions are deductible up to 5 164,57 € / year

## CSV Import Format

Transactions can be bulk-imported via CSV. Expected columns (semicolon-separated):

```
Buchungsdatum; Beschreibung; Soll Euro; Haben Euro; Kategorie; Bank; Immobilie
```

`Immobilie` is optional (name of the property to link the transaction to). The `kreditkarte` flag can be set via UI checkbox during import.
