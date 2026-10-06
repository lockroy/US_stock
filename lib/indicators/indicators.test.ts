import assert from "node:assert/strict";
import { test } from "node:test";
import { rsi, ema, emaSeries, macd, stochastic, atr, bollinger, volumeWeightedPrice,
  rollingVolumeWeightedPrice, computeIndicators, type Candle } from "./indicators";
import { scoreTechnical } from "../scoring/scoring";

function approx(actual: number | null, expected: number, tolerance = 1e-9) {
  assert.ok(actual !== null && Number.isFinite(actual), `expected a finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function candle(close: number, time: number, volume = 100): Candle {
  return { time, open: close, high: close + 1, low: close - 1, close, volume };
}

// Published Wilder RSI worked example: initial average followed by one recursive update.
const wilderCloses = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
  45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];

test("Wilder RSI matches reference values at initialization and after smoothing", () => {
  approx(rsi(wilderCloses.slice(0, 15)), 70.46413502109705);
  approx(rsi(wilderCloses), 66.24961855355505);
});

test("RSI is neutral on a flat series, 100 on rising prices, and zero on falling prices", () => {
  approx(rsi(Array(30).fill(100)), 50);
  approx(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
  approx(rsi(Array.from({ length: 30 }, (_, i) => 100 - i)), 0);
});

test("EMA seeds with an SMA and leaves warmup entries unavailable", () => {
  assert.deepEqual(emaSeries([1, 2, 3, 4], 3), [null, null, 2, 3]);
  approx(ema([5, 5, 5, 5, 5], 3), 5);
  assert.throws(() => ema([1, 2], 3), RangeError);
});

test("MACD signal matches a hand-calculated 2/3/2 example", () => {
  // SMA-seeded EMA2/EMA3 on [1,2,3,2,1,2,3]: final MACD 145/648,
  // EMA2 of MACD 53/324, histogram 13/216.
  const m = macd([1, 2, 3, 2, 1, 2, 3], 2, 3, 2);
  approx(m.macd, 145 / 648);
  approx(m.signal, 53 / 324);
  approx(m.hist, 13 / 216);
});

test("default MACD on a linear ramp has equal line and signal, not an artificial histogram", () => {
  const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
  approx(m.macd, 7);
  approx(m.signal, 7);
  approx(m.hist, 0);
});

test("a positive MACD can lie below its signal as momentum slows", () => {
  const closes = [...Array.from({ length: 60 }, (_, i) => 100 + i), ...Array(15).fill(159)];
  const m = macd(closes);
  assert.ok(m.macd! > 0 && m.macd! < m.signal! && m.hist! < 0);
});

test("MACD reports signal warmup instead of inventing a value", () => {
  assert.deepEqual(macd(Array(25).fill(100)), { macd: null, signal: null, hist: null });
  assert.deepEqual(macd(Array(26).fill(100)), { macd: 0, signal: null, hist: null });
  assert.deepEqual(macd(Array(34).fill(100)), { macd: 0, signal: 0, hist: 0 });
});

test("KD 9/3/3 recursively retains previous K and D", () => {
  const first = stochastic(Array(9).fill(100), Array(9).fill(0), Array(9).fill(100));
  approx(first.k, 200 / 3);
  approx(first.d, 500 / 9);
  const second = stochastic(Array(10).fill(100), Array(10).fill(0), Array(10).fill(100));
  approx(second.k, 700 / 9);
  approx(second.d, 1700 / 27);
  assert.ok(second.k > first.k && second.d > first.d);
  assert.deepEqual(stochastic(Array(10).fill(100), Array(10).fill(100), Array(10).fill(100)), { k: 50, d: 50 });
});

test("ATR uses Wilder smoothing after its first mean and includes gaps", () => {
  const candles = [
    { time: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
    { time: 1, open: 11, high: 13, low: 10, close: 12, volume: 1 },
    { time: 2, open: 13, high: 16, low: 12, close: 15, volume: 1 },
    { time: 3, open: 17, high: 20, low: 16, close: 18, volume: 1 },
  ];
  approx(atr(candles.slice(0, 3), 3), 3);
  approx(atr(candles, 3), 11 / 3);
});

test("Bollinger bands use the specified window and population standard deviation", () => {
  const b = bollinger([999, 1, 2, 3], 3);
  approx(b.mid, 2);
  approx(b.upper, 2 + 2 * Math.sqrt(2 / 3));
  approx(b.lower, 2 - 2 * Math.sqrt(2 / 3));
});

test("weighted price uses typical prices and volume, not an unweighted close average", () => {
  approx(volumeWeightedPrice([candle(10, 0, 1), candle(20, 1, 3)]), 17.5);
  assert.equal(volumeWeightedPrice([]), null);
  assert.equal(volumeWeightedPrice([candle(10, 0, 0)]), null);
});

test("20-day weighted price ignores older days and requires a full window", () => {
  const candles = [candle(1000, 0, 1000), ...Array.from({ length: 20 }, (_, i) => candle(10, i + 1))];
  approx(rollingVolumeWeightedPrice(candles), 10);
  assert.equal(rollingVolumeWeightedPrice(candles.slice(0, 19)), null);
});

test("zero-volume prices do not earn weighted-price points or count as available", () => {
  const indicators = computeIndicators(Array.from({ length: 200 }, (_, i) => candle(100 + i, i, 0)));
  assert.equal(indicators.volumeWeightedPrice20, null);
  const factor = scoreTechnical(indicators).factors.find(f => f.sub === "20日成交量加權均價")!;
  assert.equal(factor.score, 0);
  assert.equal(factor.available, false);
});

test("complete snapshots have finite values and bounded RSI/KD", () => {
  const candles = Array.from({ length: 250 }, (_, i) => candle(100 + Math.sin(i / 10) * 10 + i * 0.05, i));
  const snapshot = computeIndicators(candles);
  assert.ok(Object.values(snapshot).every(value => typeof value === "number" && Number.isFinite(value)));
  for (const value of [snapshot.rsi, snapshot.k, snapshot.d]) assert.ok(value >= 0 && value <= 100);
  assert.ok(snapshot.atr >= 0);
});

test("insufficient history, invalid prices, duplicate timestamps and bad periods are rejected", () => {
  const candles = Array.from({ length: 200 }, (_, i) => candle(100, i));
  assert.throws(() => computeIndicators(candles.slice(0, 199)), RangeError);
  for (const changes of [{ close: NaN }, { low: 101 }, { time: 198 }, { volume: -1 }]) {
    const broken = [...candles.slice(0, 199), { ...candles[199], ...changes }];
    assert.throws(() => computeIndicators(broken), RangeError);
  }
  assert.throws(() => rsi([1, 2, 3]), RangeError);
  assert.throws(() => ema([1, 2, 3], 0), RangeError);
  assert.throws(() => macd([1, 2, 3], 3, 2), RangeError);
});
