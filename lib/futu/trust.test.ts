import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/report/route";
import { buildReport, ReportError } from "./client";
import * as nasdaq from "./nasdaq";
import * as mock from "./mock";
import { score, scoreFundamental, scoreSentiment } from "../scoring/scoring";
import { computeIndicators } from "../indicators/indicators";
import { audit } from "../fable/fable";

const daily = mock.mockDailyCandles("US.AAPL");
const quote = { ...mock.mockQuote("US.AAPL"), symbol: "AAPL" };
const provider: typeof nasdaq = {
  ...nasdaq,
  fetchVerifiedQuote: async () => quote,
  fetchDaily: async () => daily,
  fetchSummary: async () => null,
  fetchFinancials: async () => null,
  fetchSpyTrend: async () => null,
  fetchSectorStrength: async () => null,
};
const completeScore = score({
  financials: mock.mockFinancials("US.AAPL"), valuation: mock.mockValuation("US.AAPL"),
  ratings: mock.mockRatings("US.AAPL"), indicators: computeIndicators(daily),
  marketTrendUp: true, sectorStrong: true,
});
const memo = { trend: "", keyLevels: "", momentum: "", volatility: "", invalidation: "跌破停損退出" };

async function withFetch(fetcher: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = original; }
}

test("FCF and debt independently earn five points, including zero and negative equity ratios", () => {
  for (const [fcf, debt, expected] of [[-1, 2, 0], [1, 2, 5], [-1, 0.5, 5], [1, 0.5, 10], [1, -1, 5], [0, 1, 0]]) {
    const result = scoreFundamental({ revenueGrowth: 0, epsGrowth: 0, grossMargin: 0, roe: 0, roic: 0, fcf, debtToEquity: debt });
    assert.equal(result.factors[2].score, expected);
  }
});

test("unknown macro inputs earn no optimistic points; observed weakness stays distinct", () => {
  assert.equal(scoreSentiment(null, null, null).score, 0);
  assert.equal(scoreSentiment(null, false, false).score, 2);
  assert.equal(scoreSentiment(null, true, true).score, 7);
});

test("real report preserves unknowns, exposes weighted completeness and suppresses tier", async () => {
  const report = await buildReport(" aapl ", { provider, realData: true });
  assert.equal(report.mode, "real");
  assert.equal(report.score.completeness.percent, 30);
  assert.equal(report.score.tier, "資料不足 / 暫不評級");
  assert.equal(report.sources.sectorStrong, "unknown");
  assert.equal(report.sources.marketTrendUp, "unknown");
  assert.equal(report.sources.financials, "unknown");
  assert.equal(report.sources.valuation, "unknown");
  assert.equal(report.sources.ratings, "unknown");
  assert.equal(report.sources.news, "unknown");
  assert.deepEqual(report.news, []);
  assert.deepEqual(report.candlesIntraday, []);
  assert.equal(report.score.total, Math.round(report.score.factors.reduce((sum, f) => sum + f.score, 0)));
  assert.notEqual(report.audit.verdict, "核准");
});

test("real report never replaces missing daily prices with generated candles", async () => {
  for (const candles of [null, daily.slice(0, 199)]) {
    await assert.rejects(buildReport("AAPL", { realData: true, provider: { ...provider, fetchDaily: async () => candles } }),
      (e: unknown) => e instanceof ReportError && e.status === 503);
  }
});

test("explicit demo is labelled and never calls the real provider", async () => {
  const report = await buildReport("US.AAPL", { realData: false, provider: { ...provider, fetchVerifiedQuote: async () => { throw new Error("must not fetch"); } } });
  assert.equal(report.mode, "demo");
  assert.equal(report.sources.quote, "mock");
  assert.equal(report.sources.news, "mock");
  assert.equal(report.sources.sectorStrong, "unknown");
  assert.equal(report.score.completeness.percent, 93);
});

test("invalid syntax is rejected before any provider lookup", async () => {
  for (const symbol of ["THIS_IS_NOT_A_STOCK", " ", "AAPL&symbol=TSLA", "../AAPL"]) {
    await assert.rejects(buildReport(symbol, { provider, realData: true }), (e: unknown) => e instanceof ReportError && e.status === 400);
  }
});

test("quote lookup distinguishes missing symbols, network denial and unusable responses", async () => {
  for (const [response, expected] of [[new Response("", { status: 404 }), "SYMBOL_NOT_FOUND"],
    [new Response("", { status: 403 }), "DATA_UNAVAILABLE"],
    [Response.json({ data: null }), "DATA_UNAVAILABLE"],
    [Response.json({ data: { symbol: "AAPL", primaryData: { lastSalePrice: "N/A" } } }), "DATA_UNAVAILABLE"],
    [Response.json({ data: { symbol: "MSFT", primaryData: { lastSalePrice: "$100" } } }), "DATA_UNAVAILABLE"]] as const) {
    await withFetch(async () => response, async () => {
      await assert.rejects(nasdaq.fetchVerifiedQuote("AAPL"), (e: unknown) => e instanceof nasdaq.QuoteLookupError && e.code === expected);
    });
  }
  await withFetch(async () => { throw new Error("timeout"); }, async () => {
    await assert.rejects(nasdaq.fetchVerifiedQuote("AAPL"), (e: unknown) => e instanceof nasdaq.QuoteLookupError && e.code === "DATA_UNAVAILABLE");
  });
});

test("provider-confirmed missing symbol does not become a fake report", async () => {
  await assert.rejects(buildReport("ZZZZZZ", { realData: true, provider: { ...provider, fetchVerifiedQuote: async () => { throw new nasdaq.QuoteLookupError("SYMBOL_NOT_FOUND"); } } }),
    (e: unknown) => e instanceof ReportError && e.status === 404);
});

test("audit rejects reversed prices, nonfinite prices, missing stops and poor reward/risk", () => {
  for (const plan of [{ entry: 100, stop: 999, target: 1 }, { entry: 100, stop: 0, target: 130 },
    { entry: NaN, stop: 90, target: 130 }, { entry: 100, stop: 90, target: 110 }]) {
    assert.equal(audit(completeScore, memo, { ...plan, buyZone: "90 ~ 110" }).verdict, "拒絕");
  }
});

test("valid gross reward/risk cannot approve unverified fees or backtesting", () => {
  const result = audit(completeScore, memo, { entry: 100, stop: 90, target: 130, buyZone: "90 ~ 110" });
  assert.equal(result.verdict, "未驗證");
  assert.equal(result.items.find(i => i.name === "交易費用")?.pass, null);
  assert.equal(result.items.find(i => i.name === "過度擬合")?.pass, null);
  assert.equal(result.items.find(i => i.name === "風險回報")?.pass, true);
});

test("report HTTP handler returns 400, 404 and 503 with actionable errors", async () => {
  const originalMode = process.env.REAL_DATA;
  process.env.REAL_DATA = "true";
  try {
    const missing = await GET(new NextRequest("http://localhost/api/report"));
    assert.equal(missing.status, 400);
    const invalid = await GET(new NextRequest("http://localhost/api/report?symbol=BAD_SYMBOL"));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "INVALID_SYMBOL");
    for (const [status, expectedCode, expectedStatus] of [[404, "SYMBOL_NOT_FOUND", 404], [403, "DATA_UNAVAILABLE", 503]] as const) {
      await withFetch(async () => new Response("", { status }), async () => {
        const result = await GET(new NextRequest("http://localhost/api/report?symbol=ZZZZZZ"));
        assert.equal(result.status, expectedStatus);
        assert.equal((await result.json()).code, expectedCode);
      });
    }
  } finally {
    if (originalMode === undefined) delete process.env.REAL_DATA; else process.env.REAL_DATA = originalMode;
  }
});


test("missing valuation fields reduce completeness without inflating known scores", () => {
  const input = {
    financials: mock.mockFinancials("US.AAPL"),
    valuation: { ...mock.mockValuation("US.AAPL"), peg: null, pb: null },
    ratings: mock.mockRatings("US.AAPL"), indicators: computeIndicators(daily),
    marketTrendUp: true, sectorStrong: true,
  };
  const result = score(input);
  assert.equal(result.completeness.percent, 88);
  assert.equal(result.tier, "資料不足 / 暫不評級");
  assert.equal(result.factors.find(f => f.sub === "P/E")?.available, undefined);
  assert.equal(result.factors.find(f => f.sub === "PEG")?.available, false);
  assert.equal(result.factors.find(f => f.sub === "P/B")?.available, false);
});


test("malformed real candles produce a data-unavailable error instead of numerical signals", async () => {
  for (const patch of [{ close: NaN }, { high: 0 }, { time: daily[248].time }]) {
    const broken = [...daily.slice(0, 249), { ...daily[249], ...patch }];
    await assert.rejects(buildReport("AAPL", { realData: true, provider: { ...provider, fetchDaily: async () => broken } }),
      (e: unknown) => e instanceof ReportError && e.status === 503);
  }
});
