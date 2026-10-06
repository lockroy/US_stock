import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { getStockData, getSearchData, type DataKind } from "./data";
import { aggregateCandles } from "./candles";
import { stockDataRequest, searchDataRequest } from "./api";
import { ReportError, buildReport } from "./client";
import { normalizeTicker } from "./symbol";
import * as nasdaq from "./nasdaq";
import * as mock from "./mock";

const kinds: DataKind[] = ["quote", "candles", "financials", "valuation", "ratings", "news"];
const provider = {
  ...nasdaq,
  fetchVerifiedQuote: async () => ({ ...mock.mockQuote("US.AAPL"), symbol: "AAPL" }),
  fetchDaily: async () => mock.mockDailyCandles("US.AAPL"),
  fetchFinancials: async () => null,
  fetchSummary: async () => null,
};
const day = (date: string) => Date.parse(date + "T00:00:00Z") / 1000;
const daily = [
  { time: day("2025-12-29"), open: 10, high: 12, low: 9, close: 11, volume: 2 },
  { time: day("2026-01-02"), open: 12, high: 16, low: 10, close: 15, volume: 3 },
  { time: day("2026-01-05"), open: 14, high: 15, low: 13, close: 14, volume: 4 },
];

async function inMode(mode: "true" | "false", fetcher: typeof fetch, run: () => Promise<void>) {
  const previousMode = process.env.REAL_DATA;
  const originalFetch = globalThis.fetch;
  process.env.REAL_DATA = mode;
  globalThis.fetch = fetcher;
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    if (previousMode === undefined) delete process.env.REAL_DATA; else process.env.REAL_DATA = previousMode;
  }
}

test("symbol normalization trims, strips US prefix, accepts share classes and rejects URL injection", () => {
  assert.equal(normalizeTicker(" us.aapl "), "AAPL");
  assert.equal(normalizeTicker("brk.b"), "BRK.B");
  assert.equal(normalizeTicker("BRK-B"), "BRK-B");
  for (const symbol of ["", " ", "BAD_SYMBOL", "AAPL?x=1", "../TSLA"]) assert.equal(normalizeTicker(symbol), null);
});

test("weekly OHLCV uses Monday buckets across year boundaries and does not mutate input", () => {
  const before = structuredClone(daily);
  assert.deepEqual(aggregateCandles(daily, "week"), [
    { time: day("2025-12-29"), open: 10, high: 16, low: 9, close: 15, volume: 5 },
    { time: day("2026-01-05"), open: 14, high: 15, low: 13, close: 14, volume: 4 },
  ]);
  assert.deepEqual(daily, before);
});

test("monthly OHLCV separates years and keeps first open, last close, extrema and summed volume", () => {
  assert.deepEqual(aggregateCandles(daily, "month"), [
    { time: day("2025-12-01"), open: 10, high: 12, low: 9, close: 11, volume: 2 },
    { time: day("2026-01-01"), open: 12, high: 16, low: 10, close: 14, volume: 7 },
  ]);
  assert.deepEqual(aggregateCandles([], "month"), []);
});

test("aggregation handles leap days and rejects unsorted candles", () => {
  const leap = [{ ...daily[0], time: day("2024-02-29") }, { ...daily[1], time: day("2024-03-01") }];
  assert.deepEqual(aggregateCandles(leap, "month").map(c => c.time), [day("2024-02-01"), day("2024-03-01")]);
  assert.throws(() => aggregateCandles([...daily].reverse(), "week"), RangeError);
});

test("every data API validates symbols before contacting the provider", async () => {
  let calls = 0;
  const noCalls = { ...provider, fetchVerifiedQuote: async () => { calls++; throw new Error("must not contact provider"); } };
  for (const kind of kinds) await assert.rejects(getStockData(kind, "BAD_SYMBOL", "day", { realData: true, provider: noCalls }),
    (e: unknown) => e instanceof ReportError && e.status === 400);
  assert.equal(calls, 0);
});

test("demo mode honours REAL_DATA=false for all data routes and does not fetch real data", async () => {
  await inMode("false", async () => { throw new Error("must not contact network"); }, async () => {
    for (const kind of kinds) {
      const response = await stockDataRequest(new NextRequest(`http://localhost/api/${kind}?symbol= aapl `), kind);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body = await response.json();
      assert.equal(body.symbol, "US.AAPL");
      assert.equal(body.mode, "demo");
      assert.equal(body.source, "mock");
      assert.ok(body.data);
    }
    const response = await searchDataRequest(new NextRequest("http://localhost/api/search?q=Apple"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "demo");
    assert.equal(body.source, "mock");
    assert.equal(body.data[0].symbol, "US.AAPL");
  });
});

test("real optional fields stay unknown instead of fabricated data", async () => {
  for (const kind of ["financials", "valuation", "ratings", "news"] as const) {
    const result = await getStockData(kind, "AAPL", "day", { realData: true, provider });
    assert.equal(result.mode, "real");
    assert.equal(result.source, "unknown");
    assert.deepEqual(result.data, kind === "news" ? [] : null);
  }
});

test("real intraday is explicitly unavailable; demo intraday is explicitly mock", async () => {
  const real = await getStockData("candles", "AAPL", "1D", { realData: true, provider });
  assert.equal(real.source, "unknown");
  assert.deepEqual(real.data, []);
  const demo = await getStockData("candles", "AAPL", "1D", { realData: false });
  assert.equal(demo.source, "mock");
  assert.ok(Array.isArray(demo.data) && demo.data.length > 0);
});

test("weekly/monthly routes actually aggregate and identify underlying sources", async () => {
  for (const range of ["week", "month"] as const) {
    const result = await getStockData("candles", "AAPL", range, { realData: true, provider: { ...provider, fetchDaily: async () => daily } });
    assert.equal(result.range, range);
    assert.equal(result.source, "derived");
    assert.equal(result.inputSource, "nasdaq");
    assert.deepEqual(result.data, aggregateCandles(daily, range));
    const demo = await getStockData("candles", "AAPL", range, { realData: false });
    assert.equal(demo.inputSource, "mock");
    assert.equal(demo.mode, "demo");
  }
});

test("invalid ranges and unavailable daily data cannot silently return daily or mock prices", async () => {
  await assert.rejects(getStockData("candles", "AAPL", "year", { realData: true, provider }),
    (e: unknown) => e instanceof ReportError && e.code === "INVALID_RANGE");
  for (const data of [null, [], [...daily].reverse()]) {
    await assert.rejects(getStockData("candles", "AAPL", "day", { realData: true, provider: { ...provider, fetchDaily: async () => data } }),
      (e: unknown) => e instanceof ReportError && e.status === 503);
  }
});

test("every real data route returns 404 for missing symbols and 503 for provider denial", async () => {
  for (const status of [404, 403]) await inMode("true", async () => new Response("", { status }), async () => {
    for (const kind of kinds) {
      const response = await stockDataRequest(new NextRequest(`http://localhost/api/${kind}?symbol=ZZZZZZ`), kind);
      assert.equal(response.status, status === 404 ? 404 : 503);
      assert.equal((await response.json()).code, status === 404 ? "SYMBOL_NOT_FOUND" : "DATA_UNAVAILABLE");
    }
  });
});

test("search differentiates verified zero results from upstream failure", async () => {
  const missing = { ...provider, fetchVerifiedQuote: async () => { throw new nasdaq.QuoteLookupError("SYMBOL_NOT_FOUND"); } };
  const response = await getSearchData("ZZZZZZ", { realData: true, provider: missing });
  assert.deepEqual(response.data, []);
  assert.equal(response.source, "nasdaq");
  const failed = { ...provider, fetchVerifiedQuote: async () => { throw new nasdaq.QuoteLookupError("DATA_UNAVAILABLE"); } };
  await assert.rejects(getSearchData("AAPL", { realData: true, provider: failed }), (e: unknown) => e instanceof ReportError && e.status === 503);
});

test("missing/blank query parameters return 400 on all routes", async () => {
  for (const kind of kinds) {
    const response = await stockDataRequest(new NextRequest(`http://localhost/api/${kind}?symbol=%20`), kind);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "MISSING_SYMBOL");
  }
  const response = await searchDataRequest(new NextRequest("http://localhost/api/search?q=%20"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "MISSING_Q");
});


test("report and individual demo endpoints agree on quote and intraday mode", async () => {
  const report = await buildReport("AAPL", { realData: false });
  const quote = await getStockData("quote", "AAPL", "day", { realData: false });
  assert.equal((quote.data as { lastPrice: number }).lastPrice, report.quote.lastPrice);
  const intraday = await getStockData("candles", "AAPL", "1D", { realData: false });
  assert.equal(intraday.source, report.sources.candlesIntraday);
  assert.equal((intraday.data as unknown[]).length, report.candlesIntraday.length);
  assert.equal(report.mode, intraday.mode);
});
