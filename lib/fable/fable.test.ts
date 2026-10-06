import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../types";
import { findBuyPoints, buildMemo, buildRules } from "./fable";
import { computeIndicators } from "../indicators/indicators";

function candle(close: number, time: number, volume = 1000): Candle {
  return { time, open: close, high: close + 0.2, low: close - 0.2, close, volume };
}
function risingHistory() {
  return Array.from({ length: 199 }, (_, i) => candle(100 + i * 0.1, i));
}
const signal = candle(120.8, 199, 1500);

test("no buy markers before EMA200 has enough history", () => {
  assert.deepEqual(findBuyPoints([...risingHistory().slice(0, 198), candle(150, 198, 10000)]), []);
  // Previously a negative slice created an empty resistance window and a false breakout.
  assert.deepEqual(findBuyPoints(Array.from({ length: 10 }, (_, i) => ({ ...candle(i === 2 ? 101 : 100, i, 1), high: 1000 }))), []);
});

test("confirmed breakout with 1.5x volume, ordered EMAs and weighted-price support gets a marker", () => {
  const points = findBuyPoints([...risingHistory(), signal]);
  assert.equal(points.length, 1);
  assert.equal(points[0].time, 199);
  assert.equal(points[0].price, 120.8);
  assert.match(points[0].reason, /1.5倍/);
  assert.match(points[0].reason, /EMA20 > EMA50 > EMA200/);
});

test("volume must reach 1.5x previous 20-bar average, without including the signal bar", () => {
  assert.deepEqual(findBuyPoints([...risingHistory(), { ...signal, volume: 1499 }]), []);
  assert.equal(findBuyPoints([...risingHistory(), { ...signal, volume: 1500 }]).length, 1);
});

test("a close above yesterday's close is insufficient without breaking the previous five highs", () => {
  assert.deepEqual(findBuyPoints([...risingHistory(), candle(119.9, 199, 2000)]), []);
});

test("volume and price breakouts do not create a marker in a bearish EMA trend", () => {
  const falling = Array.from({ length: 199 }, (_, i) => candle(140 - i * 0.1, i));
  assert.deepEqual(findBuyPoints([...falling, candle(122, 199, 5000)]), []);
});

test("zero reference volume and prices below the weighted average do not get markers", () => {
  assert.deepEqual(findBuyPoints([...risingHistory().map(c => ({ ...c, volume: 0 })), signal]), []);
  assert.deepEqual(findBuyPoints([...risingHistory(), { ...signal, high: 10000 }]), []);
});

test("later prices cannot change a historical signal", () => {
  const prefix = [...risingHistory(), signal];
  const before = findBuyPoints(prefix);
  assert.equal(before.length, 1);
  assert.deepEqual(findBuyPoints([...prefix, candle(50, 200, 100), candle(51, 201, 100)]), before);
});

test("only the most recent three confirmed signals are returned", () => {
  const candles = risingHistory();
  for (let i = 199; i < 220; i++) candles.push(candle(120.8 + (i - 199), i, 1500 * 2 ** (i - 199)));
  const points = findBuyPoints(candles);
  assert.equal(points.length, 3);
  assert.deepEqual(points.map(p => p.time), [217, 218, 219]);
});

test("memo describes MACD position rather than claiming an unobserved crossover", () => {
  const candles = [...risingHistory(), signal];
  const indicators = { ...computeIndicators(candles), rsi: 50, macd: 1, macdSignal: 2 };
  const memo = buildMemo(indicators, candles);
  assert.match(memo.momentum, /MACD線在訊號線下方/);
  assert.doesNotMatch(memo.momentum, /金叉|死叉/);
  assert.match(buildRules(memo)[0].entry, /前20根均量1.5倍/);
  assert.match(buildRules(memo)[0].timeframe, /下一交易時段/);
});


test("today's daily signal waits until 16:00 New York, including daylight saving changes", () => {
  for (const [day, beforeClose, afterClose] of [
    ["2026-10-06", "2026-10-06T19:59:59Z", "2026-10-06T20:00:00Z"],
    ["2026-12-01", "2026-12-01T20:59:59Z", "2026-12-01T21:00:00Z"],
  ]) {
    const midnight = Date.parse(`${day}T00:00:00Z`) / 1000;
    const candles = [...risingHistory(), signal].map((c, i) => ({ ...c, time: midnight - (199 - i) * 86400 }));
    assert.deepEqual(findBuyPoints(candles, new Date(beforeClose)), []);
    assert.equal(findBuyPoints(candles, new Date(afterClose)).length, 1);
    assert.deepEqual(findBuyPoints(candles, new Date(`${day}T01:00:00Z`)), []);
  }
});
