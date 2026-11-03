// Read-only production audit. No retries, no simulated data, no secrets in output.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

(async () => {
  const base = new URL(process.env.AUDIT_BASE_URL || 'https://us-stock.lock8974.workers.dev');
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Expected an HTTP website');
  const output = resolve(process.env.AUDIT_OUTPUT_DIR || '.playwright/live-data-audit');
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
  const results = { checkedAt: new Date().toISOString(), base: base.origin, version: null, reports: [] };
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/api/version', base).href, { timeout: 30000 });
    results.version = JSON.parse(await page.locator('body').innerText());
    for (const symbol of ['AAPL', 'MSFT', 'TSLA', 'GOOGL', 'TSM']) {
      try {
        const response = await page.evaluate(async symbol => {
          const response = await fetch('/api/report?symbol=' + symbol, { signal: AbortSignal.timeout(45000), cache: 'no-store' });
          return { status: response.status, body: await response.json() };
        }, symbol);
        const r = response.body;
        writeFileSync(resolve(output, symbol + '.json'), JSON.stringify(r, null, 2));
        if (response.status !== 200) throw new Error('Report HTTP ' + response.status);
        const failures = [];
        if (r.mode !== 'real' || !r.sources || Object.values(r.sources).includes('mock')) failures.push('Real-source contract violated');
        if (r.quote?.symbol?.replace(/^US\./, '') !== symbol) failures.push('Wrong stock returned');
        if (r.strategy?.technical?.status === '符合入場條件' && r.strategy.technical.checks.some(c => c.pass !== true)) failures.push('Entry allowed with unresolved checks');
        if (r.candlesIntraday?.length && r.sources.candlesIntraday === 'unknown') failures.push('Intraday candles without source');
        const checks = r.financials?.statementChecks?.checks ?? [];
        const row = { symbol, status: response.status, failures, quote: { asOf: r.quote?.asOf, timestamp: r.quote?.timestamp, isRealTime: r.quote?.isRealTime, marketStatus: r.quote?.marketStatus }, timing: r.timing, marketCap: r.marketCap,
          priceAdjustment: r.comparability?.priceAdjustment ?? 'unknown', dividendEvents: r.comparability?.dividends?.events?.length ?? 0,
          dividendsComplete: r.comparability?.dividends?.completeness ?? 'unknown', sources: r.sources,
          financialPeriod: r.financials?.periodEnd, epsNote: r.financials?.notes?.epsGrowth,
          statementChecks: checks.map(({key,status,candidates}) => ({key,status,candidates})), technicalStatus: r.strategy?.technical?.status };
        results.reports.push(row);
        console.log(symbol, JSON.stringify({ status: row.status, failures, quoteDate: r.timing?.quoteDate, dailyDate: r.timing?.lastClosedDailyDate, matched: checks.filter(c => c.status === 'matched').length, total: checks.length }));
      } catch (error) { results.reports.push({symbol, error: error.message}); console.error(symbol, error.message); }
    }
    writeFileSync(resolve(output, 'summary.json'), JSON.stringify(results, null, 2));
    if (results.version.mode !== 'real' || results.reports.some(r => r.error || r.failures?.length)) process.exitCode = 1;
    console.log('Evidence saved to', output, '(availability is not independent verification)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
