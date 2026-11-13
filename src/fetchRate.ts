#!/usr/bin/env node

/**
 * Maintains data/rates.csv as a rolling window of hourly USDT lending rates.
 *
 * Each run:
 *   1. Reads the existing rows from rates.csv.
 *   2. Fetches only the missing hours from the OKX history API: normally just the newest
 *      hour (1 request), plus any gap in the window, or a backfill when the CSV is new/short.
 *   3. Archives each finished month to data/YYYY-MM.csv (never overwrites an existing archive).
 *   4. Drops rows older than RETENTION_DAYS and writes rates.csv back.
 *
 * renderRateImage.ts only reads CSVs; it never calls the API.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OKXHistoryResponse {
  code: string;
  data: Array<{
    amt: string;
    ccy: string;
    rate: string;
    ts: string;
  }>;
  msg: string;
}

interface RateRecord {
  timestamp: string;
  preRate: string;
}

const API_BASE_URL = 'https://www.okx.com/api/v5/finance/savings/lending-rate-history';
const DATA_DIR = path.join(__dirname, '../data');
const CSV_PATH = path.join(DATA_DIR, 'rates.csv');

// Keep > 31 days so the previous month is still complete when it gets archived,
// with margin for missed CI runs. The chart only shows the last 30 days.
const RETENTION_DAYS = 40;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// The API returns at most 100 rows per request; 24h chunks (24 rows) stay well below it.
const CHUNK_MS = DAY_MS;

function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function monthStartMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Fetch hourly records with startMs <= ts <= endMs. */
async function fetchRange(startMs: number, endMs: number): Promise<Map<number, string>> {
  const url = new URL(API_BASE_URL);
  url.searchParams.set('ccy', 'USDT');
  // OKX pagination: `after` = return records older than ts, `before` = newer than ts (both exclusive)
  url.searchParams.set('after', (endMs + 1).toString());
  url.searchParams.set('before', (startMs - 1).toString());

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data: OKXHistoryResponse = await response.json();
  if (data.code !== '0') {
    throw new Error(`API error: ${data.msg || 'Unknown error'}`);
  }

  const result = new Map<number, string>();
  for (const record of data.data ?? []) {
    const ts = parseInt(record.ts);
    const rate = parseFloat(record.rate);
    if (!isFinite(ts) || !isFinite(rate)) continue;
    if (ts < startMs || ts > endMs) continue;
    result.set(floorToHour(ts), record.rate);
  }
  return result;
}

/** Fetch [startMs, endMs] in day-sized chunks and merge into `rows`. */
async function fetchInto(rows: Map<number, string>, startMs: number, endMs: number): Promise<number> {
  let added = 0;
  for (let chunkStart = startMs; chunkStart <= endMs; chunkStart += CHUNK_MS) {
    const chunkEnd = Math.min(chunkStart + CHUNK_MS - 1, endMs);
    console.log(`Fetching ${new Date(chunkStart).toISOString()} → ${new Date(chunkEnd).toISOString()}`);
    const chunk = await fetchRange(chunkStart, chunkEnd);
    for (const [ts, rate] of chunk) {
      if (!rows.has(ts)) added++;
      rows.set(ts, rate);
    }
    if (chunkStart + CHUNK_MS <= endMs) {
      // Be gentle with the API when backfilling several days
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return added;
}

async function readCsv(filePath: string): Promise<Map<number, string>> {
  const rows = new Map<number, string>();
  if (!fs.existsSync(filePath)) return rows;
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row: RateRecord) => {
        const ts = new Date(row.timestamp).getTime();
        const rate = parseFloat(row.preRate);
        if (!isNaN(ts) && isFinite(rate)) {
          rows.set(floorToHour(ts), row.preRate);
        }
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function writeCsv(filePath: string, rows: Array<[number, string]>): void {
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  const content = 'timestamp,preRate\n' +
    sorted.map(([ts, rate]) => `${new Date(ts).toISOString()},${rate}`).join('\n') + '\n';
  fs.writeFileSync(filePath, content);
}

function hoursInMonth(key: string): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)]; // [start, end)
}

/** Finished months that have rows in the window but no archive file yet. */
function unarchivedFinishedMonths(rows: Map<number, string>, nowMs: number): string[] {
  const currentMonthStart = monthStartMs(nowMs);
  const months = new Set<string>();
  for (const ts of rows.keys()) {
    if (ts < currentMonthStart) months.add(monthKey(ts));
  }
  return [...months].sort().filter(key => !fs.existsSync(path.join(DATA_DIR, `${key}.csv`)));
}

/**
 * Write data/YYYY-MM.csv for each finished month without an archive (never overwrites).
 * Missing hours have already been refetched from the month start, so a month is normally
 * complete. If the API still lacks some hours, wait until a day after month end (the last
 * hours may just be published late), then archive what exists with a warning instead of
 * letting pruning silently delete the month.
 */
function archiveFinishedMonths(rows: Map<number, string>, nowMs: number): void {
  for (const key of unarchivedFinishedMonths(rows, nowMs)) {
    const [start, end] = hoursInMonth(key);
    const monthRows = [...rows].filter(([ts]) => ts >= start && ts < end);
    const expected = (end - start) / HOUR_MS;

    if (monthRows.length < expected) {
      if (nowMs < end + DAY_MS) {
        console.log(`Skipping archive ${key}: ${monthRows.length}/${expected} hours so far, retrying next run`);
        continue;
      }
      console.warn(`WARNING: archiving ${key} with ${monthRows.length}/${expected} hours; the API has no data for the rest`);
    }

    writeCsv(path.join(DATA_DIR, `${key}.csv`), monthRows);
    console.log(`Archived ${monthRows.length} rows to data/${key}.csv`);
  }
}

/** Group the hours in [startMs, endMs] that are not in `rows` into contiguous [from, to] ranges. */
function missingRanges(rows: Map<number, string>, startMs: number, endMs: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let ts = startMs; ts <= endMs; ts += HOUR_MS) {
    if (rows.has(ts)) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === ts - HOUR_MS) last[1] = ts;
    else ranges.push([ts, ts]);
  }
  return ranges;
}

async function fetchLendingRate(): Promise<void> {
  try {
    const nowMs = Date.now();
    const currentHour = floorToHour(nowMs);
    const windowStart = currentHour - RETENTION_DAYS * DAY_MS;
    console.log(`[${new Date(nowMs).toISOString()}] Updating rolling window (${RETENTION_DAYS} days)...`);

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const rows = await readCsv(CSV_PATH);
    console.log(`Loaded ${rows.size} existing rows from ${CSV_PATH}`);

    // Ignore rows from the future (clock skew / bad edits) so they cannot block fetching
    for (const ts of [...rows.keys()]) {
      if (ts > currentHour) rows.delete(ts);
    }

    // Fill every missing hour in the window, not just the two ends. Unarchived finished
    // months are filled from their first hour so their archive is complete.
    let fillStart = windowStart;
    for (const key of unarchivedFinishedMonths(rows, nowMs)) {
      fillStart = Math.min(fillStart, hoursInMonth(key)[0]);
    }

    let added = 0;
    for (const [from, to] of missingRanges(rows, fillStart, currentHour)) {
      added += await fetchInto(rows, from, to);
    }
    console.log(`Added ${added} new rows`);

    // Archive before pruning so a finished month is saved while still complete
    archiveFinishedMonths(rows, nowMs);

    const kept = [...rows].filter(([ts]) => ts >= windowStart);
    if (kept.length === 0) {
      throw new Error('No data available in the rolling window');
    }
    writeCsv(CSV_PATH, kept);
    console.log(`Wrote ${kept.length} rows to ${CSV_PATH} (pruned ${rows.size - kept.length})`);
  } catch (error) {
    console.error('Error fetching lending rate:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchLendingRate();
}

export default fetchLendingRate;
