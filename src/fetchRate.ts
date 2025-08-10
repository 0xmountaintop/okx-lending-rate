#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as createCsvWriter from 'csv-writer';

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

async function fetchLendingRate(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Fetching OKX lending rate...`);
    
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
if (require.main === module) {
  fetchLendingRate();
}

export default fetchLendingRate;
