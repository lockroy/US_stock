import assert from "node:assert/strict";
import { test } from "node:test";
import * as nasdaq from "./nasdaq";
import * as mock from "./mock";
import { buildPlan, buildMemo } from "../fable/fable";
import { computeIndicators } from "../indicators/indicators";
import { getNews } from "../news/provider";
import { buildReport } from "./client";
import { getStockData } from "./data";

async function withFetch(fetcher: typeof fetch, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = previous; }
}
const candleRow = { date: "01/02/2025", open: "$10", high: "$12", low: "$9", close: "$11", volume: "1,000" };

test("missing quote fields stay null and fetch time cannot masquerade as trade time", async () => {
  await withFetch(async () => Response.json({ data: { symbol: "AAPL", primaryData: { lastSalePrice: "$100", netChange: "N/A", percentageChange: "--", volume: "N/A" } } }), async () => {
    const quote = await nasdaq.fetchVerifiedQuote("AAPL");
    assert.equal(quote.change, null);
    assert.equal(quote.changePct, null);
    assert.equal(quote.volume, null);
    assert.equal(quote.timestamp, null);
    assert.equal(quote.asOf, null);
    assert.equal(quote.isRealTime, null);
    assert.ok(quote.fetchedAt! > 0);
  });
});

test("disclosed zero quote changes and volume are preserved, along with supplier time text", async () => {
  await withFetch(async () => Response.json({ data: { symbol: "AAPL", isRealTime: false, primaryData: { lastSalePrice: "$100", netChange: "0.00", percentageChange: "0.00%", volume: "0", lastTradeTimestamp: "Supplier original time" } } }), async () => {
    const quote = await nasdaq.fetchVerifiedQuote("AAPL");
    assert.equal(quote.change, 0);
    assert.equal(quote.changePct, 0);
    assert.equal(quote.volume, 0);
    assert.equal(quote.asOf, "Supplier original time");
    assert.equal(quote.isRealTime, false);
    assert.equal(quote.timestamp, null);
  });
});

test("invalid price is rejected, malformed optional prices never parse as numeric prefixes", async () => {
  await withFetch(async () => Response.json({ data: { symbol: "AAPL", primaryData: { lastSalePrice: "100bad" } } }), async () => {
    await assert.rejects(nasdaq.fetchVerifiedQuote("AAPL"));
  });
});

test("missing summary values are null and do not generate an invented valuation", async () => {
  await withFetch(async () => Response.json({ data: { summaryData: { MarketCap: { value: "N/A" }, OneYrTarget: { value: "--" } } } }), async () => {
    const summary = await nasdaq.fetchSummary("AAPL");
    assert.equal(summary!.marketCap, null);
    assert.equal(summary!.oneYrTarget, null);
  });
  assert.equal(nasdaq.deriveValuation(null, null), null);
});

test("historical candles reject missing volume, impossible dates, invalid OHLC and duplicate days", () => {
  for (const patch of [{ volume: "N/A" }, { open: "N/A" }, { close: "11wrong" }, { date: "02/30/2025" }, { date: "bad" }, { high: "5" }, { volume: "-1" }]) {
    assert.equal(nasdaq.parseHistoricalRows([{ ...candleRow, ...patch }]), null);
  }
  assert.equal(nasdaq.parseHistoricalRows([candleRow, candleRow]), null);
  assert.equal(nasdaq.parseHistoricalRows([{ ...candleRow, volume: "0" }])![0].volume, 0);
});

test("stocks and ETFs use the same strict history validation without silently dropping bad rows", async () => {
  await withFetch(async () => Response.json({ data: { tradesTable: { rows: [candleRow, { ...candleRow, date: "01/03/2025", volume: "N/A" }] } } }), async () => {
    assert.equal(await nasdaq.fetchDaily("AAPL"), null);
    assert.equal(await nasdaq.fetchEtfDaily("SPY"), null);
    assert.equal(await nasdaq.fetchSpyTrend(), null);
  });
});

test("sector comparison cannot mix differently dated ETF windows", async () => {
  const rows = Array.from({ length: 22 }, (_, i) => ({ ...candleRow, date: `01/${String(i + 1).padStart(2, "0")}/2025` }));
  await withFetch(async input => Response.json({ data: { tradesTable: { rows: String(input).includes("/SPY/") ? rows.slice(0, 21) : rows } } }), async () => {
    assert.equal(await nasdaq.fetchSectorStrength("Technology"), null);
  });
});

test("flat-price ATR zero stays zero instead of being replaced by an invented 2%", () => {
  const candles = mock.mockDailyCandles("AAPL").map(c => ({ ...c, open: 100, high: 100, low: 100, close: 100 }));
  const indicators = computeIndicators(candles);
  assert.equal(indicators.atr, 0);
  const plan = buildPlan(indicators, candles);
  assert.equal(plan.target, 100);
  assert.equal(plan.stop, 100);
  assert.throws(() => buildPlan({ ...indicators, atr: NaN }, candles));
  const memo = buildMemo({ ...indicators, ema20: 120, ema50: 110, ema200: 100 }, candles);
  assert.ok(!memo.trend.includes("更高低點"));
});

test("paused news never contacts providers, in both report and news API paths", async () => {
  const previous = process.env.NEWS_ENABLED;
  process.env.NEWS_ENABLED = "false";
  let calls = 0;
  const newsProvider = async () => { calls++; throw new Error("must not request news"); };
  const provider = { ...nasdaq, fetchVerifiedQuote: async () => mock.mockQuote("AAPL"), fetchDaily: async () => mock.mockDailyCandles("AAPL"), fetchSummary: async () => null, fetchFinancials: async () => null, fetchSpyTrend: async () => null };
  try {
    assert.equal((await getNews("AAPL", newsProvider)).status, "disabled");
    const report = await buildReport("AAPL", { realData: true, provider, newsProvider });
    assert.equal(report.newsStatus, "disabled");
    assert.equal(report.sources.news, "unknown");
    assert.deepEqual(report.news, []);
    assert.equal((await getStockData("news", "AAPL", "day", { realData: true, provider, newsProvider })).status, "disabled");
    assert.equal(calls, 0);
    assert.ok(!Object.values(report.sources).includes("mock"));
  } finally {
    if (previous === undefined) delete process.env.NEWS_ENABLED; else process.env.NEWS_ENABLED = previous;
  }
});
