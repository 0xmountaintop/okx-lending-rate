# AGENTS.md


+ During you interaction with the user, if you find anything reusable in this project (e.g. version of a library, model name), especially about a fix to a mistake you made or a correction you received, you should take note in the `Lessons` section in the `AGENTS.md` file so you will not make the same mistake again. 
+ You should also use the `AGENTS.md` file as a scratchpad to organize your thoughts. Especially when you receive a new task, you should first review the content of the scratchpad, clear old different task but keep lessons learned, then explain the task, and plan the steps you need to take to complete the task. You can use todo markers to indicate the progress, e.g.
[X] Task 1
[ ] Task 2

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) when working with code in this repository.

## Project Overview

This is an OKX USDT lending rate monitoring project that automatically fetches lending rates from the OKX API and generates visual charts. The project runs hourly via GitHub Actions and stores historical data with automated commit/push workflows.

## Key Commands

### Development
- `npm run fetch` - Fill missing hours of the 40-day rolling window in `data/rates.csv`, archive finished months, prune old rows
- `npm run render` - Generate SVG chart from existing CSV data  
- `npm run dev` - Run both fetch and render scripts sequentially
- `npm run build` - Compile TypeScript to JavaScript (outputs to ./dist)

### Setup
- `npm install` - Install all dependencies
- `npm ci` - Clean install for production/CI environments

## Architecture

### Core Components
- **fetchRate.ts** (`src/fetchRate.ts`): Maintains `data/rates.csv` as a 40-day rolling window: fetches only missing hours (gaps, new hours, backfill) from the OKX history API, archives finished months to `data/YYYY-MM.csv`, prunes old rows
- **renderRateImage.ts** (`src/renderRateImage.ts`): D3.js-based chart generator that reads CSV data and creates SVG visualizations using JSDOM

### Data Flow
1. `fetchRate.ts` reads `data/rates.csv`, finds missing UTC hours in the window (plus unarchived finished months from their first hour), and fetches them from `https://www.okx.com/api/v5/finance/savings/lending-rate-history?ccy=USDT` in 24h chunks (`after`/`before` are exclusive cursors, max 100 rows/response)
2. The history `rate` field is stored as `preRate` (same value as the summary API's `preRate`); one row per UTC hour
3. Finished months are written once to `data/YYYY-MM.csv` (complete, or after a 1-day grace period with a warning if the API lacks hours); then rows older than 40 days are pruned and `rates.csv` rewritten
4. `renderRateImage.ts` draws `output/rates.svg` (README chart) from `data/rates.csv` only — last 30 days before the newest row — and `output/YYYY-MM.svg` from each archive (skipped if the SVG already exists). Render never calls the API.

### File Structure
- `src/fetchRate.ts` - Incremental fetch, monthly archiving, rolling-window pruning
- `src/renderRateImage.ts` - D3.js chart generation with JSDOM rendering
- `data/rates.csv` - Rolling 40-day hourly data (timestamp, preRate columns)
- `data/YYYY-MM.csv` - Archived finished months
- `output/rates.svg` - Last 30 days chart (embedded in README)
- `output/YYYY-MM.svg` - Per-month charts

## GitHub Actions Automation

The project uses `.github/workflows/fetch-rate.yml` which:
- Runs hourly at 5 minutes past each hour (`5 * * * *`)
- Executes fetch → render → commit → push workflow
- Commits changes with timestamp: "Update lending rate data - YYYY-MM-DD HH:MM:SS UTC"

## Technical Notes

### TypeScript Configuration
- ES2022 target with ESNext modules
- Strict mode enabled with declaration maps
- Uses ts-node with ESM loader for direct execution

### Key Dependencies
- **csv-writer/csv-parser**: CSV file operations
- **d3**: Data visualization and chart generation  
- **jsdom**: Server-side DOM for SVG rendering
- **typescript/ts-node**: TypeScript compilation and execution

### Data Validation
- API responses validated for `code: '0'` and non-empty data array
- Rate values checked as finite numbers before storage
- Duplicate prevention based on UTC hour matching

### Error Handling
- Both scripts exit with code 1 on errors
- HTTP response status validation for API calls
- File system checks before CSV/directory operations


## Lessons

### Date/Time Issues
- When parsing CSV timestamps like "2025-08-01T00:00:00.000Z", timezone interpretation can cause month mismatches
- JavaScript Date.getUTCMonth() returns 0-indexed months (0=Jan, 7=Aug)
- The timestamp "2025-08-01T00:00:00.000Z" gets parsed as July 31st in local timezone (PDT), not August 1st UTC
- Always compare dates in UTC methods for consistent behavior
### Data persistence
- Monthly archive CSVs (`data/YYYY-MM.csv`) are created in CI at month rollover; the workflow must `git add data/` (not just `data/rates.csv`), otherwise they are lost. Archives 2025-08..2026-09 were lost this way (their SVGs survive); 2026-10 was backfilled from the `lending-rate-history` API.
- OKX publishes each hourly history value by ~:05 and it does not change later (verified against 40 CI commits), so existing rows never need refetching.
- Don't commit a locally regenerated `data/rates.csv` / `output/rates.svg` while CI is committing hourly — it conflicts; CI self-heals the rolling window on its next run.

### Node.js version
- CI uses Node 24 LTS (EOL 2028-04-30) with `check-latest: true` so setup-node always installs the newest 24.x security patch rather than a stale runner-cached one. Node 18 (EOL 2025-04) and 20 (EOL 2026-04) are unsupported. Check https://nodejs.org/dist/index.json (`security: true`) and https://github.com/nodejs/Release/blob/main/schedule.json before choosing a version.
- Local machine uses nvm (`/root/.nvm`); verified working on v24.22.3 with npm 12.2.2.
