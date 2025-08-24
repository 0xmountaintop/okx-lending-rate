#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

const API_BASE_URL = 'https://www.okx.com/api/v5/finance/savings/lending-rate-history';
const CSV_PATH = path.join(__dirname, '../data/rates.csv');

interface RateRecord {
  timestamp: string;
  preRate: string;
}


async function fetchHistoricalRates(startDate: string, endDate: string): Promise<RateRecord[]> {
  const startTimestamp = new Date(startDate).getTime();
  const endTimestamp = new Date(endDate).getTime();
  
  console.log(`Fetching historical data from ${startDate} to ${endDate}`);
  
  const url = new URL(API_BASE_URL);
  url.searchParams.set('ccy', 'USDT');
  url.searchParams.set('after', endTimestamp.toString());
  url.searchParams.set('before', startTimestamp.toString());
  
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
      // Only include records from the target day
      return recordDate.getUTCFullYear() === targetDate.getUTCFullYear() &&
             recordDate.getUTCMonth() === targetDate.getUTCMonth() &&
             recordDate.getUTCDate() === targetDate.getUTCDate();
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  console.log(`Filtered to ${filteredRecords.length} records in date range`);
  return filteredRecords;
}

async function fetchLendingRate(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Fetching OKX lending rates for current month...`);
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentHour = now.getUTCHours();
    
    console.log(`Fetching data from ${currentYear}-${currentMonth.toString().padStart(2, '0')}-01 00:00 to current hour`);
    
    const allHistoricalData: RateRecord[] = [];
    
    // Fetch data day by day from the 1st of current month until today
    for (let day = 1; day <= currentDay; day++) {
      const dayStr = day.toString().padStart(2, '0');
      const monthStr = currentMonth.toString().padStart(2, '0');
      
      // For the current day, only fetch up to current hour
      let endHour = '23:59:59';
      if (day === currentDay) {
        endHour = `${currentHour.toString().padStart(2, '0')}:59:59`;
      }
      
      const prevDay = new Date(`${currentYear}-${monthStr}-${dayStr}T00:00:00Z`);
      prevDay.setDate(prevDay.getDate() - 1);
      const startDate = prevDay.toISOString().replace('T00:00:00.000Z', 'T23:59:59Z');
      const endDate = `${currentYear}-${monthStr}-${dayStr}T${endHour}Z`;
      
      console.log(`\n--- Fetching data for ${currentYear}-${monthStr}-${dayStr} (up to ${endHour}) ---`);
      
      const dayData = await fetchHistoricalRates(startDate, endDate);
      allHistoricalData.push(...dayData);
      
      console.log(`Collected ${dayData.length} records for day ${dayStr}, total: ${allHistoricalData.length}`);
      
      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (allHistoricalData.length === 0) {
      console.log('No historical data found for the current month');
      return;
    }
    
    console.log(`\nFetched ${allHistoricalData.length} total records for current month`);
    
    // Sort data chronologically
    allHistoricalData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Ensure directory exists
    const csvDir = path.dirname(CSV_PATH);
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true });
    }
    
    // Overwrite CSV file with all current month data
    const csvContent = 'timestamp,preRate\n' + 
      allHistoricalData.map(record => `${record.timestamp},${record.preRate}`).join('\n') + '\n';
    
    fs.writeFileSync(CSV_PATH, csvContent);
    console.log(`Successfully overwrote ${CSV_PATH} with ${allHistoricalData.length} records`);

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
