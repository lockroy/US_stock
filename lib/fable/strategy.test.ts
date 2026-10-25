import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle, Quote } from "../types";
import { computeIndicators } from "../indicators/indicators";
import { score, type ScoreInput } from "../scoring/scoring";
import { assessStrategy } from "./strategy";
import { findBuyPoints } from "./fable";
import { buildReport } from "../futu/client";
import * as nasdaq from "../futu/nasdaq";
import { quoteDay } from "./timeliness";
import calendar from "../market/xnys-sessions.json";

const day = Date.parse("2026-10-16T00:00:00Z") / 1000;
const asOf = new Date("2026-10-16T20:01:00Z");
function history(): Candle[] {
  const days = Object.keys(calendar.sessions).filter(d => d <= "2026-10-16").slice(-200);
  const bars = days.map((date, i) => {
    const close = 100 + i * 0.1;
    return { time: Date.parse(`${date}T00:00:00Z`) / 1000, open: close, close, high: close + 0.2, low: close - 0.2, volume: 1000 };
  });
  // 過去壓力高於近期突破位，可檢查目標及 2:1 風險回報，不捏造已實現回報。
  bars[180].high = 150;
  bars[199] = { ...bars[199], open: 120.8, close: 120.8, high: 121, low: 120.6, volume: 1500 };
  return bars;
}
const quote: Quote = { symbol: "US.AAPL", name: "fixture", lastPrice: 120.8, change: null, changePct: null, volume: null, timestamp: null, asOf: "Oct 16, 2026" };
function input(candles = history()): ScoreInput {
  return { financials: null, valuation: null, ratings: null, indicators: computeIndicators(candles), marketTrendUp: null, sectorStrong: null };
}

test("missing fundamentals, valuation, ratings and news do not block a verified technical setup", () => {
  const result = assessStrategy(score(input()), history(), quote, asOf);
  assert.equal(result.technical.status, "符合入場條件");
  assert.equal(result.fundamental.status, "資料不足");
  assert.ok(result.technical.rewardRisk! >= 2);
  assert.ok(result.technical.referencePlan);
  assert.ok(result.caveats.some(s => s.includes("基本面或估值未確認")));
});

test("a high partial score cannot manufacture a missing breakout or volume trigger", () => {
  const bars = history();
  bars[199].volume = 1000;
  const result = assessStrategy(score(input(bars)), bars, quote, asOf);
  assert.equal(result.technical.status, "等待觸發");
  assert.equal(result.technical.checks.find(c => c.name === "成交量觸發")?.pass, false);
  const untriggered = history();
  untriggered[199] = { ...untriggered[199], open: 119.9, close: 119.9, high: 120, low: 119.7 };
  const second = assessStrategy(score(input(untriggered)), untriggered, quote, asOf);
  assert.equal(second.technical.status, "等待觸發");
  assert.equal(second.technical.checks.find(c => c.name === "收盤突破")?.pass, false);
});

test("missing or zero-volume technical inputs withhold plans rather than lowering stock quality", () => {
  const short = history().slice(-199);
  const insufficient = assessStrategy(score(input()), short, quote, asOf);
  assert.equal(insufficient.technical.status, "資料不足");
  assert.equal(insufficient.technical.referencePlan, null);
  const zero = history().map(c => ({ ...c, volume: 0 }));
  const result = assessStrategy(score(input(zero)), zero, quote, asOf);
  assert.equal(result.technical.status, "資料不足");
  assert.equal(result.technical.referencePlan, null);
  assert.deepEqual(findBuyPoints(zero, asOf), []);
});

test("malformed price, stale history and invalid bars never produce entry references", () => {
  for (const [bars, price, now] of [
    [history(), NaN, asOf], [history(), 0, asOf],
    [history(), quote.lastPrice, new Date("2026-10-22T20:01:00Z")],
    [history().map((c, i) => i === 199 ? { ...c, volume: NaN } : c), quote.lastPrice, asOf],
  ] as const) {
    const result = assessStrategy(score(input()), bars, { ...quote, lastPrice: price }, now);
    assert.equal(result.technical.status, "資料不足");
    assert.equal(result.technical.referencePlan, null);
  }
});

test("an older historical buy marker cannot become the latest entry signal", () => {
  const bars = history();
  bars.push({ ...bars[199], time: day + 3 * 86400, close: 120.7, open: 120.7, volume: 1000 });
  const result = assessStrategy(score(input(bars)), bars, { ...quote, lastPrice: 120.7, asOf: "Oct 19, 2026" }, new Date("2026-10-19T20:01:00Z"));
  assert.equal(findBuyPoints(bars, new Date("2026-10-19T20:01:00Z"))[0].time, day);
  assert.equal(result.technical.evaluatedBarTime, day + 3 * 86400);
  assert.equal(result.technical.status, "等待觸發");
});

test("a missing Friday session is stale on Sunday despite a three-day calendar gap", () => {
  const result = assessStrategy(score(input()), history(), quote, new Date("2026-10-18T15:00:00Z"));
  assert.equal(result.technical.checks.find(c => c.name === "日線時效")?.pass, true);
  const missingFriday = history();
  const dates = Object.keys(calendar.sessions).filter(d => d < "2026-10-16").slice(-200);
  missingFriday.forEach((bar, i) => { bar.time = Date.parse(`${dates[i]}T00:00:00Z`) / 1000; });
  const stale = assessStrategy(score(input(missingFriday)), missingFriday, quote, new Date("2026-10-18T15:00:00Z"));
  assert.equal(stale.technical.checks.find(c => c.name === "日線時效")?.pass, null);
  assert.equal(stale.technical.referencePlan, null);
});

test("an unclosed 200th bar cannot trigger a strategy even when it looks like a breakout", () => {
  const result = assessStrategy(score(input()), history(), quote, new Date("2026-10-16T19:59:59Z"));
  assert.equal(result.technical.status, "資料不足");
  assert.equal(result.technical.referencePlan, null);
});

test("poor reward/risk, bearish trends and invalid stop ordering fail conditions rather than claim missing data", () => {
  const bars = history();
  bars[180].high = bars[180].close + 0.2;
  const poor = assessStrategy(score(input(bars)), bars, quote, asOf);
  assert.equal(poor.technical.status, "條件不符合");
  assert.equal(poor.technical.checks.find(c => c.name === "毛風險回報")?.pass, false);
  const invalidStop = assessStrategy(score(input()), history(), { ...quote, lastPrice: 1 }, asOf);
  assert.equal(invalidStop.technical.status, "條件不符合");
  assert.equal(invalidStop.technical.referencePlan, null);
  const falling = history().map((c, i) => ({ ...c, open: 140 - i * 0.1, close: 140 - i * 0.1, high: 140.2 - i * 0.1, low: 139.8 - i * 0.1 }));
  const bearish = assessStrategy(score(input(falling)), falling, { ...quote, lastPrice: falling[199].close }, asOf);
  assert.equal(bearish.technical.status, "條件不符合");
});

test("a new quote below the breakout cannot reuse yesterday's confirmed signal", () => {
  const result = assessStrategy(score(input()), history(), { ...quote, lastPrice: 119 }, asOf);
  assert.equal(result.technical.status, "等待觸發");
  assert.equal(result.technical.checks.find(c => c.name === "報價維持突破")?.pass, false);
});

test("fundamental entries require complete research and technical triggers; partial high scores remain unknown", () => {
  const complete = { ...input(), financials: { revenueGrowth: 15, epsGrowth: 15, grossMargin: 50, roe: 50, roic: 50, fcf: 1, debtToEquity: 0.5 },
    valuation: { pe: 10, peg: 1, pb: 1, ps: null, evSales: null, fcfYield: 8 } };
  const good = assessStrategy(score(complete), history(), quote, asOf);
  assert.equal(good.fundamental.status, "符合入場條件");
  assert.ok(good.fundamental.checks.every(c => c.pass));
  const untriggered = history();
  untriggered[199].volume = 1000;
  assert.equal(assessStrategy(score(complete), untriggered, quote, asOf).fundamental.status, "等待觸發");
  assert.equal(assessStrategy(score(complete), history().slice(-199), quote, asOf).fundamental.status, "資料不足");
  const partial = assessStrategy(score({ ...complete, financials: { ...complete.financials, fcf: null } }), history(), quote, asOf);
  assert.equal(partial.fundamental.status, "資料不足");
  const weak = assessStrategy(score({ ...complete, financials: { ...complete.financials, revenueGrowth: 0, epsGrowth: 0, grossMargin: 0, roe: 0, roic: 0 } }), history(), quote, asOf);
  assert.equal(weak.fundamental.status, "條件不符合");
});

test("zero ATR is an observed inability to size this setup, not an invented fallback", () => {
  const bars = history().map(c => ({ ...c, open: 100, high: 100, low: 100, close: 100 }));
  const result = assessStrategy(score(input(bars)), bars, { ...quote, lastPrice: 100 }, asOf);
  assert.equal(result.technical.status, "條件不符合");
  assert.equal(result.technical.referencePlan, null);
});

test("report API assembly exposes no unconditional plan when necessary volume is unusable", async () => {
  const bars = history().map(c => ({ ...c, volume: 0 }));
  const report = await buildReport("AAPL", { realData: true, newsProvider: async () => ({ data: [], source: "unknown", status: "disabled", message: "新聞暫停" }), provider: {
    ...nasdaq, fetchVerifiedQuote: async () => quote, fetchDaily: async () => bars,
    fetchSummary: async () => null, fetchFinancials: async () => null, fetchSpyTrend: async () => null,
  } });
  assert.equal(report.plan, null);
  assert.equal(report.strategy.technical.status, "資料不足");
  assert.equal(report.audit.verdict, "未驗證");
  assert.deepEqual(report.buyPoints, []);
  assert.ok(Object.values(report.sources).every(s => s !== "mock"));
});

test("quote date extraction is strict and never uses fetchedAt or guesses a timezone", () => {
  assert.equal(quoteDay({ ...quote, asOf: "Oct 16, 2026 4:01 PM ET" }), "2026-10-16");
  assert.equal(quoteDay({ ...quote, asOf: "2026-10-16" }), "2026-10-16");
  for (const asOf of ["Feb 30, 2026", "not a date", "16/10/2026", ""]) {
    assert.equal(quoteDay({ ...quote, asOf, fetchedAt: Date.now() / 1000 }), null);
  }
  assert.equal(quoteDay({ ...quote, timestamp: Date.parse("2026-10-17T00:01:00Z") / 1000 }), "2026-10-16");
  assert.equal(quoteDay({ ...quote, timestamp: 1e100 }), null);
});

test("older, future and unconfirmed quotes suppress current plans without changing historical signals or scores", () => {
  const bars = history();
  const known = score(input());
  const before = findBuyPoints(bars, asOf);
  assert.equal(before.length, 1);
  for (const date of ["Oct 15, 2026", "Oct 17, 2026", ""]) {
    const q = { ...quote, asOf: date };
    const snapshot = { ...q };
    const result = assessStrategy(known, bars, q, asOf);
    assert.equal(result.technical.status, "資料不足");
    assert.equal(result.technical.referencePlan, null);
    assert.equal(result.technical.checks.find(c => c.name === "報價／日線日期")?.pass, null);
    assert.deepEqual(q, snapshot);
    assert.deepEqual(findBuyPoints(bars, asOf), before);
    assert.deepEqual(score(input()), known);
  }
});

test("known fundamental failure stays distinct from an unrelated missing valuation", () => {
  const result = score({ ...input(), financials: { revenueGrowth: -10, epsGrowth: -20, grossMargin: 10, roe: 2, roic: 1, fcf: -1, debtToEquity: 2 } });
  const assessment = assessStrategy(result, history(), quote, asOf);
  assert.equal(assessment.fundamental.status, "條件不符合");
  assert.equal(assessment.fundamental.checks[0].pass, false);
  assert.equal(assessment.fundamental.checks[1].pass, null);
});
