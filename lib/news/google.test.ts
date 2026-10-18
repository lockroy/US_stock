import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGoogleNews, parseGoogleNews } from "./google";
import { buildReport } from "../futu/client";
import { getStockData } from "../futu/data";
import * as nasdaq from "../futu/nasdaq";
import * as mock from "../futu/mock";

const now = new Date("2026-10-18T15:00:00Z");
const item = (id = "one", date = "Sun, 18 Oct 2026 12:00:00 GMT", link = `https://news.google.com/rss/articles/${id}`) =>
  `<item><title><![CDATA[Apple & Microsoft - Publisher]]></title><link>${link}</link><pubDate>${date}</pubDate><source url="https://example.com">Publisher &amp; Co</source></item>`;
const rss = (items = "") => `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>${items}</channel></rss>`;
const provider = {
  ...nasdaq, fetchVerifiedQuote: async () => mock.mockQuote("US.AAPL"),
  fetchDaily: async () => mock.mockDailyCandles("US.AAPL"), fetchSummary: async () => null,
  fetchFinancials: async () => null, fetchSpyTrend: async () => null,
};

test("RSS parses CDATA, entities and attributed sources; deduplicates and sorts latest first", () => {
  const data = parseGoogleNews(rss(item() + item() + item("older", "Sat, 17 Oct 2026 12:00:00 GMT")), now);
  assert.equal(data.length, 2);
  assert.equal(data[0].title, "Apple & Microsoft - Publisher");
  assert.equal(data[0].source, "Publisher & Co");
  assert.ok(data[0].time > data[1].time);
  assert.equal(data[0].summary, "");
});

test("RSS rejects HTML, malformed XML, unsafe URLs and entity declarations", () => {
  for (const xml of ["<html>Denied</html>", "<rss><channel>", '<!DOCTYPE rss [<!ENTITY x "x">]>' + rss(), rss(item("x", undefined, "javascript:alert(1)")), rss(item("x", undefined, "https://news.google.com.evil.test/rss/articles/x"))]) {
    assert.throws(() => parseGoogleNews(xml, now));
  }
});

test("empty channel and dated-out articles are empty; invalid date is a format failure", () => {
  assert.deepEqual(parseGoogleNews(rss(), now), []);
  assert.deepEqual(parseGoogleNews(rss(item("old", "Mon, 01 Jan 2024 00:00:00 GMT") + item("future", "Sun, 18 Oct 2026 23:00:00 GMT")), now), []);
  assert.throws(() => parseGoogleNews(rss(item("x", "invalid")), now));
});

test("Google RSS needs no credentials, uses ticker search and limits to ten articles", async () => {
  const result = await fetchGoogleNews(" us.aapl ", { now, fetcher: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://news.google.com");
    assert.equal(url.searchParams.get("q"), "AAPL stock when:7d");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return new Response(rss(Array.from({ length: 12 }, (_, i) => item(String(i))).join("")));
  } });
  assert.equal(result.status, "ready");
  assert.equal(result.source, "google_news");
  assert.equal(result.data.length, 10);
  assert.equal(result.fetchedAt, now.getTime() / 1000);
});

test("no results, quota, HTTP errors, oversized responses and network failure remain distinct", async () => {
  assert.equal((await fetchGoogleNews("AAPL", { now, fetcher: async () => new Response(rss()) })).status, "empty");
  for (const [code, status] of [[403, "unavailable"], [503, "unavailable"], [429, "rate_limited"]] as const) {
    const result = await fetchGoogleNews("AAPL", { fetcher: async () => new Response("Denied", { status: code }) });
    assert.equal(result.status, status);
    assert.equal(result.source, "unknown");
    assert.deepEqual(result.data, []);
  }
  for (const fetcher of [async () => new Response("x".repeat(2_000_001)), async () => { throw new Error("network"); }]) {
    assert.equal((await fetchGoogleNews("AAPL", { fetcher })).status, "unavailable");
  }
});

test("invalid tickers do not request Google", async () => {
  assert.equal((await fetchGoogleNews("../bad", { fetcher: async () => { throw new Error("must not fetch"); } })).status, "unavailable");
});

test("report and independent endpoint share real news; failure never changes scores or fabricates news", async () => {
  const newsProvider = () => fetchGoogleNews("AAPL", { now, fetcher: async () => new Response(rss(item())) });
  const options = { realData: true, provider, newsProvider };
  const report = await buildReport("AAPL", options);
  const data = await getStockData("news", "AAPL", "day", options);
  assert.equal(report.sources.news, "google_news");
  assert.equal(report.newsStatus, "ready");
  assert.deepEqual(report.news, data.data);
  const failed = await buildReport("AAPL", { ...options, newsProvider: () => fetchGoogleNews("AAPL", { fetcher: async () => { throw new Error("offline"); } }) });
  assert.equal(failed.newsStatus, "unavailable");
  assert.equal(failed.sources.news, "unknown");
  assert.deepEqual(failed.news, []);
  assert.deepEqual(failed.score, report.score);
});
