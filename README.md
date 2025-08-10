# OKX Lending Rate Monitor

Automated monitoring and visualization of OKX USDT lending rates using TypeScript and GitHub Actions.

## Overview

This project fetches USDT lending rate data from the OKX API every hour and generates visual charts to track rate changes over time.

## Features

- **Automated Data Collection**: Fetches lending rates from OKX API hourly at 5 minutes past each hour
- **CSV Storage**: Stores historical data with UTC timestamps
- **Chart Generation**: Creates SVG line charts showing rate trends
- **GitHub Actions Integration**: Fully automated execution and data persistence
- **Duplicate Prevention**: Avoids collecting duplicate data for the same hour

## Project Structure

```
okx-lending-rate/
├── src/
│   ├── fetchRate.ts        # Data collection script
│   └── renderRateImage.ts  # Chart generation script
├── data/
│   └── rates.csv          # Historical rate data
├── output/
│   ├── rates.svg          # Generated chart
│   └── summary.txt        # Latest rate summary
├── .github/workflows/
│   └── fetch-rate.yml     # GitHub Actions workflow
└── package.json
```

## Scripts

- `npm run fetch` - Fetch current lending rate and append to CSV
- `npm run render` - Generate chart from CSV data
- `npm run dev` - Run both fetch and render scripts

## Data Format

The CSV file contains:
- `timestamp`: UTC ISO-8601 timestamp
- `preRate`: Previous lending rate as decimal (e.g., 0.05 = 5%)

## API Endpoint

Data is fetched from: `https://www.okx.com/api/v5/finance/savings/lending-rate-summary?ccy=USDT`

## GitHub Actions

The workflow runs automatically every hour at 5 minutes past the hour (0:05, 1:05, etc.) and:
1. Fetches the latest lending rate
2. Generates an updated chart
3. Commits changes back to the repository

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Test data fetching:
   ```bash
   npm run fetch
   ```

3. Generate chart:
   ```bash
   npm run render
   ```

## Requirements

- Node.js 18+
- TypeScript
- Dependencies: csv-writer, csv-parser, d3, jsdom

## Output

- **CSV Data**: `data/rates.csv` with timestamped rate history
- **SVG Chart**: `output/rates.svg` with visual trend line
- **Summary**: `output/summary.txt` with latest rate information
