#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as createCsvWriter from 'csv-writer';
import csvParser from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OKXResponse {
  code: string;
  data: Array<{
    avgAmt: string;
    avgAmtUsd: string;
    avgRate: string;
    ccy: string;
    estRate: string;
    preRate: string;
  }>;
  msg: string;
}

const API_URL = 'https://www.okx.com/api/v5/finance/savings/lending-rate-summary?ccy=USDT';
const CSV_PATH = path.join(__dirname, '../data/rates.csv');
const DATA_DIR = path.join(__dirname, '../data');

interface RateRecord {
  timestamp: string;
  preRate: string;
}

async function readCsvData(filePath: string): Promise<RateRecord[]> {
  return new Promise((resolve, reject) => {
    const results: RateRecord[] = [];
    
    if (!fs.existsSync(filePath)) {
      resolve([]);
      return;
    }

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row) => {
        results.push({
          timestamp: row.timestamp,
          preRate: row.preRate
        });
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', reject);
  });
}

async function writeCsvData(filePath: string, data: RateRecord[], append: boolean = false): Promise<void> {
  if (data.length === 0) return;

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'timestamp', title: 'timestamp' },
      { id: 'preRate', title: 'preRate' }
    ],
    append: append
  });

  if (!append) {
    // Ensure directory exists
    const csvDir = path.dirname(filePath);
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true });
    }
    
    // Write header if not appending
    fs.writeFileSync(filePath, 'timestamp,preRate\n');
  }

  await csvWriter.writeRecords(data);
}

function getMonthKey(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function performRollover(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Checking for rollover...`);
  
  if (!fs.existsSync(CSV_PATH)) {
    console.log('No existing CSV file, skipping rollover');
    return;
  }

  const existingData = await readCsvData(CSV_PATH);
  if (existingData.length === 0) {
    console.log('No existing data, skipping rollover');
    return;
  }

  const currentMonthKey = getMonthKey(new Date().toISOString());
  const dataByMonth = new Map<string, RateRecord[]>();

  // Group data by month
  for (const record of existingData) {
    const monthKey = getMonthKey(record.timestamp);
    if (!dataByMonth.has(monthKey)) {
      dataByMonth.set(monthKey, []);
    }
    dataByMonth.get(monthKey)!.push(record);
  }

  console.log(`Found data for months: ${Array.from(dataByMonth.keys()).join(', ')}`);
  console.log(`Current month: ${currentMonthKey}`);

  let hasRollover = false;
  
  // Process each month
  for (const [monthKey, monthData] of dataByMonth) {
    if (monthKey !== currentMonthKey) {
      // Archive old month data
      const archiveFilePath = path.join(DATA_DIR, `${monthKey}.csv`);
      console.log(`Archiving ${monthData.length} records for ${monthKey} to ${archiveFilePath}`);
      
      // Sort data chronologically
      monthData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // Write to archive file
      await writeCsvData(archiveFilePath, monthData, false);
      hasRollover = true;
    }
  }

  if (hasRollover) {
    // Rewrite current CSV with only current month data
    const currentMonthData = dataByMonth.get(currentMonthKey) || [];
    if (currentMonthData.length > 0) {
      console.log(`Keeping ${currentMonthData.length} records for current month ${currentMonthKey}`);
      // Sort current month data chronologically
      currentMonthData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      await writeCsvData(CSV_PATH, currentMonthData, false);
    } else {
      console.log(`No current month data, creating empty CSV file`);
      fs.writeFileSync(CSV_PATH, 'timestamp,preRate\n');
    }
    
    console.log(`Rollover completed successfully`);
  } else {
    console.log('No rollover needed - all data is from current month');
  }
}

async function fetchLendingRate(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Fetching OKX lending rate...`);
    
    // Perform rollover check before saving new data
    await performRollover();
    
    // Fetch data from OKX API
    const response = await fetch(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: OKXResponse = await response.json();
    
    // Validate response structure
    if (data.code !== '0' || !data.data || data.data.length === 0) {
      throw new Error(`Invalid API response: ${JSON.stringify(data)}`);
    }

    const preRate = data.data[0].preRate;
    
    // Validate preRate
    const preRateNum = parseFloat(preRate);
    if (isNaN(preRateNum) || !isFinite(preRateNum)) {
      throw new Error(`Invalid preRate value: ${preRate}`);
    }

    // Generate UTC timestamp
    const timestamp = new Date().toISOString();
    
    console.log(`Fetched preRate: ${preRate} at ${timestamp}`);

    // Check if CSV file exists, if not create it with headers
    const csvExists = fs.existsSync(CSV_PATH);
    if (!csvExists) {
      // Create directory if it doesn't exist
      const csvDir = path.dirname(CSV_PATH);
      if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
      }
      
      // Write header
      fs.writeFileSync(CSV_PATH, 'timestamp,preRate\n');
      console.log('Created CSV file with headers');
    }

    // Prevent duplicate entries by checking the last line
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = csvContent.trim().split('\n');
    
    if (lines.length > 1) {
      const lastLine = lines[lines.length - 1];
      const [lastTimestamp] = lastLine.split(',');
      const lastHour = new Date(lastTimestamp).getUTCHours();
      const currentHour = new Date(timestamp).getUTCHours();
      
      // Skip if we already have data for this hour
      if (lastHour === currentHour && new Date(lastTimestamp).toDateString() === new Date(timestamp).toDateString()) {
        console.log('Data for this hour already exists, skipping...');
        return;
      }
    }

    // Append new data to CSV
    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: CSV_PATH,
      header: [
        { id: 'timestamp', title: 'timestamp' },
        { id: 'preRate', title: 'preRate' }
      ],
      append: true
    });

    await csvWriter.writeRecords([{ timestamp, preRate }]);
    console.log(`Successfully appended rate data to ${CSV_PATH}`);

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
