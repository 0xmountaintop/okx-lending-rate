#!/usr/bin/env node

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

const CSV_PATH = path.join(__dirname, '../data/rates.csv');

async function fetchHistoricalRates(startDate: string, endDate: string): Promise<RateRecord[]> {
  const startTimestamp = new Date(startDate).getTime();
  const endTimestamp = new Date(endDate).getTime();
  
  console.log(`Fetching historical data from ${startDate} to ${endDate}`);
  console.log(`Timestamp range: ${startTimestamp} to ${endTimestamp}`);
  
  const url = new URL('https://www.okx.com/api/v5/finance/savings/lending-rate-history');
  url.searchParams.set('ccy', 'USDT');
  url.searchParams.set('after', endTimestamp.toString());
  url.searchParams.set('before', startTimestamp.toString());
  
  console.log(`Fetching from: ${url.toString()}`);
  
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

  if (!data.data || data.data.length === 0) {
    console.log('No data available for the specified date range');
    return [];
  }

  console.log(`Received ${data.data.length} records`);
  
  // Convert records to our format
  const records: RateRecord[] = [];
  for (const record of data.data) {
    const recordTimestamp = parseInt(record.ts);
    const isoTimestamp = new Date(recordTimestamp).toISOString();
    records.push({
      timestamp: isoTimestamp,
      preRate: record.rate
    });
  }
  
  // Filter by date range and sort chronologically
  const filteredRecords = records
    .filter(record => {
      const recordDate = new Date(record.timestamp);
      const targetDate = new Date(endDate);
      // Only include records from the target day (ignore extended range data)
      return recordDate.getUTCFullYear() === targetDate.getUTCFullYear() &&
             recordDate.getUTCMonth() === targetDate.getUTCMonth() &&
             recordDate.getUTCDate() === targetDate.getUTCDate();
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  console.log(`Filtered to ${filteredRecords.length} records in date range`);
  return filteredRecords;
}

async function readExistingData(): Promise<RateRecord[]> {
  return new Promise((resolve, reject) => {
    const results: RateRecord[] = [];
    
    if (!fs.existsSync(CSV_PATH)) {
      resolve([]);
      return;
    }

    fs.createReadStream(CSV_PATH)
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

async function prependHistoricalData(historicalData: RateRecord[]): Promise<void> {
  const existingData = await readExistingData();
  
  // Sort historical data chronologically
  historicalData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  // Combine historical + existing data
  const combinedData = [...historicalData, ...existingData];
  
  // Remove duplicates based on timestamp
  const seen = new Set<string>();
  const uniqueData = combinedData.filter(record => {
    if (seen.has(record.timestamp)) {
      return false;
    }
    seen.add(record.timestamp);
    return true;
  });
  
  console.log(`Writing ${uniqueData.length} total records (${historicalData.length} historical + ${existingData.length} existing, duplicates removed)`);
  
  // Write combined data to CSV
  const csvContent = 'timestamp,preRate\n' + 
    uniqueData.map(record => `${record.timestamp},${record.preRate}`).join('\n') + '\n';
  
  fs.writeFileSync(CSV_PATH, csvContent);
}

async function main(): Promise<void> {
  try {
    const allHistoricalData: RateRecord[] = [];
    
    // Fetch data day by day from August 1-10, 2025
    // Extend range to capture 00:00 data from previous day's end
    for (let day = 1; day <= 31; day++) {
      const dayStr = day.toString().padStart(2, '0');
      const prevDay = new Date(`2025-07-${dayStr}T00:00:00Z`);
      prevDay.setDate(prevDay.getDate() - 1);
      const startDate = prevDay.toISOString().replace('T00:00:00.000Z', 'T23:59:59Z');
      const endDate = `2025-07-${dayStr}T23:59:59Z`;
      
      console.log(`\n--- Fetching data for 2025-07-${dayStr} ---`);
      
      const dayData = await fetchHistoricalRates(startDate, endDate);
      allHistoricalData.push(...dayData);
      
      console.log(`Collected ${dayData.length} records for day ${dayStr}, total: ${allHistoricalData.length}`);
      
      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (allHistoricalData.length === 0) {
      console.log('No historical data found for the specified date range');
      return;
    }
    
    console.log(`\nFetched ${allHistoricalData.length} total historical records`);
    
    // Prepend to existing CSV
    await prependHistoricalData(allHistoricalData);
    
    console.log('Successfully prepended historical data to rates.csv');
    
  } catch (error) {
    console.error('Error fetching historical rates:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;