const fields = ['open', 'high', 'low', 'close', 'volume'];
export function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

// Deliberately accepts only the unquoted six-column Stooq daily export.
// Unexpected schemas fail rather than guessing a symbol, scale or adjusted price.
export function parseHistoryCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.shift()?.trim() !== 'Date,Open,High,Low,Close,Volume') throw new Error('Expected Date,Open,High,Low,Close,Volume header; no automatic column mapping');
  if (!lines.length) throw new Error('No daily rows');
  const seen = new Set();
  const rows = lines.map((line, i) => {
    const cells = line.split(',').map(c => c.trim());
    const fail = message => { throw new Error(`CSV line ${i + 2}: ${message}`); };
    if (cells.length !== 6 || !validDay(cells[0])) fail('invalid column count or date');
    if (seen.has(cells[0])) fail('duplicate date');
    seen.add(cells[0]);
    const values = cells.slice(1).map(value => /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN);
    if (!values.every(Number.isFinite)) fail('missing or invalid number');
    const [open, high, low, close, volume] = values;
    if ([open, high, low, close].some(v => v <= 0) || low > Math.min(open, close) || high < Math.max(open, close) || low > high) fail('invalid OHLC bounds');
    return { day: cells[0], open, high, low, close, volume };
  });
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

export function inspectHistory(rows, { symbol, expectedThrough, calendar, reference = null }) {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol ?? '')) throw new Error('Explicit stock symbol required');
  if (!validDay(expectedThrough)) throw new Error('Expected last completed session must be an ISO date');
  const first = rows[0].day, last = rows.at(-1).day;
  const observed = new Set(rows.map(r => r.day));
  const inRange = day => day >= calendar.coverageStart && day <= calendar.coverageEnd;
  const outOfCalendar = rows.filter(r => !inRange(r.day)).map(r => r.day);
  const nonSessions = rows.filter(r => inRange(r.day) && !calendar.sessions[r.day]).map(r => r.day);
  const missingSessions = Object.keys(calendar.sessions).filter(day => day >= first && day <= expectedThrough && !observed.has(day));
  const beyondExpected = rows.filter(r => r.day > expectedThrough).map(r => r.day);
  const blockers = [];
  if (rows.length < 200) blockers.push('Fewer than 200 daily bars');
  if (last !== expectedThrough) blockers.push('Latest daily date differs from expected completed session');
  if (!inRange(expectedThrough) || outOfCalendar.length) blockers.push('Dates outside reference calendar coverage');
  if (inRange(expectedThrough) && !calendar.sessions[expectedThrough]) blockers.push('Expected date is not a reference trading session');
  if (nonSessions.length || missingSessions.length || beyondExpected.length) blockers.push('Session coverage requires review');
  const zeroVolumeDays = rows.filter(r => r.volume === 0).map(r => r.day);
  if (zeroVolumeDays.length) blockers.push('Zero-volume bars require review; not replaced or discarded');
  let comparison = null;
  if (reference) {
    if (reference.mode !== 'real' || reference.sources?.candlesDaily !== 'nasdaq' || reference.quote?.symbol?.replace(/^US\./, '') !== symbol) throw new Error('Reference must be a real Nasdaq report for the same symbol');
    if (!Array.isArray(reference.candlesDaily)) throw new Error('Reference lacks daily candles');
    const byDay = new Map();
    for (const candle of reference.candlesDaily) {
      const date = new Date(candle.time * 1000);
      if (!Number.isFinite(date.getTime()) || !fields.every(f => Number.isFinite(candle[f]))) throw new Error('Invalid reference candle');
      const day = date.toISOString().slice(0, 10);
      if (byDay.has(day)) throw new Error('Duplicate reference date');
      byDay.set(day, candle);
    }
    const overlap = rows.filter(r => byDay.has(r.day));
    const differences = overlap.flatMap(r => fields.flatMap(field => {
      const original = byDay.get(r.day)[field];
      return r[field] === original ? [] : [{ day: r.day, field, candidate: r[field], reference: original, difference: r[field] - original }];
    }));
    comparison = { referenceSource: 'nasdaq', overlapDays: overlap.length, differences, note: 'Exact numeric comparison; no inferred rounding, currency or adjustment equivalence' };
    if (!overlap.length) blockers.push('No overlap with reference');
    if (differences.length) blockers.push('Observed differences require review');
  }
  return { symbol, identity: 'user_declared_not_independently_verified', rows: rows.length, first, last, expectedThrough,
    calendar: { source: calendar.source, version: calendar.version, verification: 'third_party_reference' },
    outOfCalendar, nonSessions, missingSessions, beyondExpected, zeroVolumeDays, blockers, comparison,
    automatedChecksPassed: blockers.length === 0,
    productionEligible: false,
    stillRequired: ['Confirm stock identity and currency', 'Document split, dividend and volume adjustment rules', 'Confirm source terms and automatic Worker access', 'Independent source validation; never splice a last bar into another source window'] };
}
