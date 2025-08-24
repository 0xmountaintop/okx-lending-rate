# CLAUDE.md


+ During you interaction with the user, if you find anything reusable in this project (e.g. version of a library, model name), especially about a fix to a mistake you made or a correction you received, you should take note in the `Lessons` section in the `CLAUDE.md` file so you will not make the same mistake again. 
+ You should also use the `CLAUDE.md` file as a scratchpad to organize your thoughts. Especially when you receive a new task, you should first review the content of the scratchpad, clear old different task but keep lessons learned, then explain the task, and plan the steps you need to take to complete the task. You can use todo markers to indicate the progress, e.g.
[X] Task 1
[ ] Task 2

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an OKX USDT lending rate monitoring project that automatically fetches lending rates from the OKX API and generates visual charts. The project runs hourly via GitHub Actions and stores historical data with automated commit/push workflows.

## Key Commands

### Development
- `npm run fetch` - Fetch current lending rate from OKX API and append to CSV
- `npm run render` - Generate SVG chart from existing CSV data  
- `npm run dev` - Run both fetch and render scripts sequentially
- `npm run build` - Compile TypeScript to JavaScript (outputs to ./dist)

### Setup
- `npm install` - Install all dependencies
- `npm ci` - Clean install for production/CI environments

## Architecture

### Core Components
- **fetchRate.ts** (`src/fetchRate.ts`): API client that fetches USDT lending rates from OKX, validates data, and appends to CSV with duplicate prevention
- **renderRateImage.ts** (`src/renderRateImage.ts`): D3.js-based chart generator that reads CSV data and creates SVG visualizations using JSDOM

### Data Flow
1. `fetchRate.ts` calls OKX API endpoint: `https://www.okx.com/api/v5/finance/savings/lending-rate-summary?ccy=USDT`
2. Extracts `preRate` field from API response and validates as finite number
3. Stores timestamped data in `data/rates.csv` with duplicate prevention (one entry per hour)
4. `renderRateImage.ts` reads CSV, processes data points, and generates SVG chart in `output/rates.svg`

### File Structure
- `src/fetchRate.ts` - API data collection with validation and CSV append
- `src/renderRateImage.ts` - D3.js chart generation with JSDOM rendering
- `data/rates.csv` - Historical rate data (timestamp, preRate columns)
- `output/rates.svg` - Generated line chart with grid lines and styling

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