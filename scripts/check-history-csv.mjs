// Offline only. Prints evidence; never writes market data or changes production.
import { readFileSync } from 'node:fs';
import { parseHistoryCsv, inspectHistory } from './lib/history-csv.mjs';
const [file, symbol, expectedThrough, referenceFile, ...extra] = process.argv.slice(2);
try {
  if (!file || !symbol || !expectedThrough || extra.length) throw new Error('Usage: node scripts/check-history-csv.mjs file.csv AAPL YYYY-MM-DD [real-report.json]');
  const calendar = JSON.parse(readFileSync(new URL('../lib/market/xnys-sessions.json', import.meta.url), 'utf8'));
  const reference = referenceFile ? JSON.parse(readFileSync(referenceFile, 'utf8')) : null;
  const result = inspectHistory(parseHistoryCsv(readFileSync(file, 'utf8')), { symbol, expectedThrough, calendar, reference });
  console.log(JSON.stringify(result, null, 2));
  if (!result.automatedChecksPassed) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
