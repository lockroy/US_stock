import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHistoryCsv, inspectHistory } from './lib/history-csv.mjs';
const header = 'Date,Open,High,Low,Close,Volume\n';
const calendar = JSON.parse(readFileSync(new URL('../lib/market/xnys-sessions.json', import.meta.url), 'utf8'));
const days = Object.keys(calendar.sessions).filter(day => day <= '2026-11-05').slice(-200);
const fixture = () => days.map(day => ({day, open:10, high:12, low:9, close:11, volume:100}));
const inspect = (rows, extra = {}) => inspectHistory(rows, {symbol:'AAPL', expectedThrough:'2026-11-05', calendar, ...extra});

test('CSV preserves true zero volume and sorts dates without mutating prices', () => {
  const rows = parseHistoryCsv('\uFEFF' + header + '2026-11-03,10,12,9,11,0\r\n2026-11-02,10,12,9,11,100');
  assert.equal(rows[0].day, '2026-11-02'); assert.equal(rows[1].volume, 0);
});
test('CSV rejects malformed dates, missing values, impossible prices and duplicates', () => {
  for (const row of ['2026-02-30,10,12,9,11,100','2026-11-03,10,12,9,11,','2026-11-03,10,8,9,11,100','2026-11-03,0,12,0,11,100','2026-11-03,10,12,9,11,-1','2026-11-03,10,12,9,11,100bad']) assert.throws(() => parseHistoryCsv(header + row));
  assert.throws(() => parseHistoryCsv(header + '2026-11-03,10,12,9,11,1\n2026-11-03,10,12,9,11,1'));
  assert.throws(() => parseHistoryCsv('<html>Access denied</html>'));
  assert.throws(() => parseHistoryCsv(header));
});
test('200 aligned synthetic rows never certify symbol, currency or adjusted-price equivalence', () => {
  const result = inspect(fixture());
  assert.equal(result.automatedChecksPassed, true);
  assert.equal(result.productionEligible, false);
  assert.equal(result.identity, 'user_declared_not_independently_verified');
});
test('stale data, gaps, zero volume and non-trading dates stay blocked', () => {
  assert.equal(inspect(fixture().slice(0,-1)).automatedChecksPassed,false);
  assert.equal(inspect(fixture().filter((_,i) => i !== 50)).missingSessions.length,1);
  assert.equal(inspect([...fixture(),{...fixture()[0],day:'2026-11-07'}]).automatedChecksPassed,false);
  const rows=fixture();rows[0].volume=0;assert.equal(inspect(rows).zeroVolumeDays.length,1);
  assert.equal(inspect(fixture(),{expectedThrough:'2030-01-01'}).automatedChecksPassed,false);
});
test('reference mismatches remain evidence; same-number rows do not certify provenance', () => {
  const rows=fixture(); const reference={mode:'real',sources:{candlesDaily:'nasdaq'},quote:{symbol:'AAPL'},candlesDaily:rows.map(r=>({...r,time:Date.parse(r.day+'T00:00:00Z')/1000}))};
  assert.equal(inspect(rows,{reference}).comparison.overlapDays,200);
  assert.equal(inspect(rows,{reference}).productionEligible,false);
  reference.candlesDaily[0].close=10;
  assert.equal(inspect(rows,{reference}).comparison.differences[0].field,'close');
  assert.equal(inspect(rows,{reference}).automatedChecksPassed,false);
  assert.throws(()=>inspect(rows,{reference:{...reference,mode:'demo'}}));
  assert.throws(()=>inspect(rows,{reference:{...reference,quote:{symbol:'TSLA'}}}));
});
