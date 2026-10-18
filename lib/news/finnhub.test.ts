import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchCompanyNews } from "./finnhub";
import { buildReport } from "../futu/client";
import { getStockData } from "../futu/data";
import * as nasdaq from "../futu/nasdaq";
import * as mock from "../futu/mock";

const now = new Date("2026-10-18T12:00:00Z");
const time = now.getTime() / 1000 - 3600;
const row = { headline: "Apple news", source: "Publisher", datetime: time, url: "https://example.com/apple" };
const provider = {
  ...nasdaq,
  fetchVerifiedQuote: async () => mock.mockQuote("US.AAPL"),
  fetchDaily: async () => mock.mockDailyCandles("US.AAPL"),
  fetchSummary: async () => null,
  fetchFinancials: async () => null,
  fetchSpyTrend: async () => null,
};

test("missing key performs no network request and keeps news unknown", async () => {
  const result = await fetchCompanyNews("AAPL", { apiKey: "", fetcher: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.status, "not_configured");
  assert.equal(result.source, "unknown");
});

test("news request uses normalized ticker, seven UTC days, server header and safe ordered unique links", async () => {
  const result = await fetchCompanyNews(" us.aapl ", { apiKey: "test-key", now, fetcher: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.finnhub.io");
    assert.equal(url.searchParams.get("symbol"), "AAPL");
    assert.equal(url.searchParams.get("from"), "2026-10-11");
    assert.equal(url.searchParams.get("to"), "2026-10-18");
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(new Headers(init?.headers).get("X-Finnhub-Token"), "test-key");
    assert.equal(init?.redirect, "error");
    return Response.json([row, row, { ...row, url: "javascript:alert(1)" }, { ...row, datetime: time + 99999 },
      { ...row, url: "https://example.com/new", datetime: time + 100 }, { ...row, datetime: 1 }, { ...row, headline: "" }]);
  } });
  assert.equal(result.status, "ready");
  assert.equal(result.source, "finnhub");
  assert.deepEqual(result.data.map(n => n.url), ["https://example.com/new", row.url]);
  assert.ok(result.data.every(n => n.summary === ""));
  assert.ok(!JSON.stringify(result).includes("test-key"));
});

test("verified empty news differs from malformed provider results", async () => {
  const empty = await fetchCompanyNews("AAPL", { apiKey: "test", now, fetcher: async () => Response.json([]) });
  assert.equal(empty.status, "empty");
  assert.equal(empty.source, "finnhub");
  for (const payload of [{ error: "key" }, [null], [{ ...row, url: "data:text/html,hi" }]]) {
    assert.equal((await fetchCompanyNews("AAPL", { apiKey: "test", now, fetcher: async () => Response.json(payload) })).status, "unavailable");
  }
});

test("authorization, quota, HTTP failures and timeouts never become mock news or leak errors", async () => {
  for (const [status, expected] of [[401, "unauthorized"], [403, "unauthorized"], [429, "rate_limited"], [500, "unavailable"]] as const) {
    const result = await fetchCompanyNews("AAPL", { apiKey: "test", fetcher: async () => new Response("secret error", { status }) });
    assert.equal(result.status, expected);
    assert.equal(result.source, "unknown");
    assert.deepEqual(result.data, []);
    assert.ok(!JSON.stringify(result).includes("secret error"));
  }
  assert.equal((await fetchCompanyNews("AAPL", { apiKey: "test", fetcher: async () => { throw new Error("secret timeout"); } })).status, "unavailable");
});

test("report and independent news endpoint use the same Finnhub result; news does not raise score", async () => {
  const result = await fetchCompanyNews("AAPL", { apiKey: "test", now, fetcher: async () => Response.json([row]) });
  const options = { realData: true, provider, newsProvider: async () => result };
  const report = await buildReport("AAPL", options);
  const endpoint = await getStockData("news", "AAPL", "day", options);
  assert.deepEqual(report.news, endpoint.data);
  assert.equal(report.sources.news, "finnhub");
  assert.equal(endpoint.source, "finnhub");
  assert.equal(report.newsStatus, "ready");
  const missing = await buildReport("AAPL", { ...options, newsProvider: () => fetchCompanyNews("AAPL", { apiKey: "" }) });
  assert.deepEqual(report.score, missing.score);
});

test("demo mode never calls Finnhub", async () => {
  const options = { realData: false, newsProvider: async () => { throw new Error("must not fetch"); } };
  assert.equal((await buildReport("AAPL", options)).sources.news, "mock");
  assert.equal((await getStockData("news", "AAPL", "day", options)).source, "mock");
});
