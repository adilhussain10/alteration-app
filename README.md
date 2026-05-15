# alteration-app

Standalone Go + React frontend for the AlterationModule, talking directly
to QuickBill's SQL Server tenant DB (same DB QuickBill writes to). Bills
saved in QuickBill appear here instantly — no sync layer.

## Layout

```
alteration-app/
  cmd/server/         HTTP entry point
  internal/
    alteration/       handlers (bill picker, save, reports)
    db/               SQL Server connection
  web/                React (Vite + TS + Tailwind + React Router)
  go.mod
```

## Prerequisites

- Go 1.26+
- Node 20+
- SQL Server (QuickBill's installation) with the three alteration migrations
  applied:
  - `D:\QB_Code\sql\001_seed_alteration_voucher_type.sql`
  - `D:\QB_Code\sql\002_create_alteration_tables.sql`
  - `D:\QB_Code\sql\003_fix_status_columns.sql`

## First-time setup

```powershell
# 1. Configure — copy .env.example to .env and edit DATABASE_URL.
#    Find your SQL Server port (named instance) via:
#       Get-NetTCPConnection -OwningProcess (Get-Process sqlservr).Id
#    Example .env:
#       DATABASE_URL=sqlserver://sa:Success24@localhost:64070?database=QbAppDb1
#       PORT=8080

# 2. Install web deps
cd web ; npm install ; cd ..
```

## Configuration (.env)

`.env` is auto-loaded by `godotenv/autoload`. Gitignored — copy
`.env.example` for a fresh template.

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default 8080). Match Vite's proxy target in `web/vite.config.ts`. |
| `DATABASE_URL` | SQL Server DSN: `sqlserver://USER:PASS@HOST:PORT?database=NAME` |

## Daily dev workflow

Two terminals:

```powershell
# Terminal 1 — Go API on :8080
go run ./cmd/server
```

```powershell
# Terminal 2 — Vite dev server on :5173 (proxies /api -> :8080)
cd web
npm run dev
```

## Production build

```powershell
cd web ; npm run build ; cd ..
go build -o alteration.exe ./cmd/server
```

(Eventually the React bundle will be embedded via `go:embed` so it ships as a single binary.)

## Porting roadmap

1. ~~DB schema~~ — uses QuickBill's existing SQL Server tables directly.
2. ~~`GET /api/vouchers/for-alteration`~~ — done.
3. ~~`BillPickerPage`~~ — done.
4. ~~`POST /api/voucher/{guid}/alteration`~~ — done.
5. `AlterationPage` + form — placeholder; not yet ported.
6. `PATCH .../status` — not yet ported.
7. ~~Reports handler + page~~ — done.
