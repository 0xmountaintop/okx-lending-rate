#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';
import csvParser from 'csv-parser';

interface RateData {
  timestamp: string;
  preRate: string;
  date: Date;
  rate: number;
}

const CSV_PATH = path.join(__dirname, '../data/rates.csv');
const OUTPUT_PATH = path.join(__dirname, '../output/rates.png');

async function readCsvData(): Promise<RateData[]> {
  return new Promise((resolve, reject) => {
    const results: RateData[] = [];
    
    if (!fs.existsSync(CSV_PATH)) {
      reject(new Error(`CSV file not found: ${CSV_PATH}`));
      return;
    }

    fs.createReadStream(CSV_PATH)
      .pipe(csvParser())
      .on('data', (row) => {
        const date = new Date(row.timestamp);
        const rate = parseFloat(row.preRate);
        
        if (!isNaN(rate) && isFinite(rate) && !isNaN(date.getTime())) {
          results.push({
            timestamp: row.timestamp,
            preRate: row.preRate,
            date,
            rate
          });
        }
      })
      .on('end', () => {
        // Sort by date
        results.sort((a, b) => a.date.getTime() - b.date.getTime());
        resolve(results);
      })
      .on('error', reject);
  });
}

async function generateChart(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Reading CSV data...`);
    const data = await readCsvData();
    
    if (data.length === 0) {
      throw new Error('No valid data found in CSV file');
    }

    console.log(`Found ${data.length} data points`);

    // Set up dimensions and margins
    const margin = { top: 20, right: 30, bottom: 40, left: 50 };
    const width = 800 - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    // Create DOM
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const document = dom.window.document;

    // Create SVG
    const svg = d3.select(document.body)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .attr('xmlns', 'http://www.w3.org/2000/svg');

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Set up scales
    const xScale = d3.scaleTime()
      .domain(d3.extent(data, d => d.date) as [Date, Date])
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain(d3.extent(data, d => d.rate) as [number, number])
      .nice()
      .range([height, 0]);

    // Create line generator
    const line = d3.line<RateData>()
      .x(d => xScale(d.date))
      .y(d => yScale(d.rate))
      .curve(d3.curveMonotoneX);

    // Add axes
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale)
        .tickFormat(d3.timeFormat('%m/%d %H:%M') as any));

    g.append('g')
      .call(d3.axisLeft(yScale)
        .tickFormat(d => `${(d as number * 100).toFixed(2)}%`));

    // Add axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - margin.left)
      .attr('x', 0 - (height / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('fill', '#666')
      .text('Pre Rate (%)');

    g.append('text')
      .attr('transform', `translate(${width / 2}, ${height + margin.bottom})`)
      .style('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('fill', '#666')
      .text('Time (UTC)');

    // Add title
    svg.append('text')
      .attr('x', (width + margin.left + margin.right) / 2)
      .attr('y', margin.top / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .style('fill', '#333')
      .text('OKX USDT Lending Rate (preRate)');

    // Add the line
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Add dots for data points
    g.selectAll('.dot')
      .data(data)
      .enter().append('circle')
      .attr('class', 'dot')
      .attr('cx', d => xScale(d.date))
      .attr('cy', d => yScale(d.rate))
      .attr('r', 3)
      .attr('fill', '#2563eb');

    // Add grid lines
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale)
        .tickSize(-height)
        .tickFormat('' as any))
      .style('stroke-dasharray', '3,3')
      .style('opacity', 0.3);

    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(yScale)
        .tickSize(-width)
        .tickFormat('' as any))
      .style('stroke-dasharray', '3,3')
      .style('opacity', 0.3);

    // Get SVG string
    const svgString = document.body.innerHTML;
    
    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // For now, save as SVG (we could convert to PNG using sharp or similar if needed)
    const svgPath = OUTPUT_PATH.replace('.png', '.svg');
    fs.writeFileSync(svgPath, svgString);
    
    console.log(`Chart saved to ${svgPath}`);
    
    // Also save the latest rate info as a simple text summary
    const latest = data[data.length - 1];
    const summary = `Latest OKX USDT Lending Rate
Timestamp: ${latest.timestamp}
Pre Rate: ${(latest.rate * 100).toFixed(4)}%
Total Data Points: ${data.length}
Generated: ${new Date().toISOString()}`;
    
    const summaryPath = path.join(outputDir, 'summary.txt');
    fs.writeFileSync(summaryPath, summary);
    console.log(`Summary saved to ${summaryPath}`);

  } catch (error) {
    console.error('Error generating chart:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  generateChart();
}

export default generateChart;
