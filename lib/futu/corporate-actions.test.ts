import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDividends, fetchDividends, buildComparability, unavailableDividends } from "./corporate-actions";
import { buildReport } from "./client";
import { missingDataSummary } from "../report/missing-data";
import * as nasdaq from "./nasdaq";
import * as mock from "./mock";

const cash = { exOrEffDate: "8/10/2026", type: "Cash", amount: "$0.27", currency: "USD", paymentDate: "8/13/2026", declarationDate: "7/30/2026" };
const payload = (rows: unknown[]) => ({ data: { dividends: { rows } } });

test("cash dividends retain real amounts, dates and explicit currencies without adjusting source candles", () => {
  const evidence = parseDividends(payload([cash, { ...cash, exOrEffDate: "5/11/2026", amount: "$0", currency: undefined }]), "us.aapl");
  assert.equal(evidence.status, "available");
  assert.equal(evidence.events[0].exDate, "2026-08-10");
  assert.equal(evidence.events[0].currency, "USD");
  assert.equal(evidence.events[1].amount, 0);
  assert.equal(evidence.events[1].currency, null);
  assert.equal(evidence.completeness, "unknown");
  const basis = buildComparability(mock.mockQuote("AAPL"), null, evidence);
  assert.equal(basis.priceAdjustment, "unverified");
  assert.equal(basis.financialHistory, "latest_snapshot_only");
  assert.equal(basis.security.statementCurrency, null);
});

test("empty, unavailable and malformed corporate actions cannot imply no dividends or zero cash", () => {
  assert.equal(parseDividends(payload([]), "AAPL").status, "none_reported");
  assert.equal(parseDividends({ data: null }, "AAPL").status, "unavailable");
  const result = parseDividends(payload([
    { ...cash, exOrEffDate: "2/30/2026" }, { ...cash, amount: "N/A" }, { ...cash, amount: "-1" }, { ...cash, type: "Stock" },
  ]), "AAPL");
  assert.equal(result.status, "unavailable");
  assert.equal(result.events.length, 0);
  assert.equal(result.rejectedRows, 4);
  assert.match(result.message, /不當作零派息/);
});

test("dividend adapter uses normalized fixed endpoints and distinguishes HTTP failure from an empty table", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.nasdaq.com/api/quote/AAPL/dividends?assetclass=stocks");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "manual");
      return Response.json(payload([cash]));
    };
    assert.equal((await fetchDividends("US.AAPL")).events[0].amount, 0.27);
    globalThis.fetch = async () => new Response("blocked", { status: 503 });
    assert.equal((await fetchDividends("AAPL")).status, "unavailable");
  } finally { globalThis.fetch = original; }
});

test("company-action failures preserve all other report data and do not penalize the stock score", async () => {
  const provider: typeof nasdaq = { ...nasdaq, fetchVerifiedQuote: async () => ({ ...mock.mockQuote("AAPL"), securityType: "Common Stock", exchange: "NASDAQ-GS" }),
    fetchDaily: async () => mock.mockDailyCandles("AAPL"), fetchSummary: async () => null, fetchFinancials: async () => null,
    fetchSpyTrend: async () => null, fetchSectorStrength: async () => null };
  const options = { realData: true, provider, newsProvider: async () => ({ data: [], source: "unknown" as const, status: "disabled" as const, message: "新聞暫停" }) };
  const available = await buildReport("AAPL", { ...options, dividendProvider: async () => parseDividends(payload([cash]), "AAPL") });
  const failed = await buildReport("AAPL", { ...options, dividendProvider: async () => { throw new Error("unavailable"); } });
  assert.deepEqual(available.score, failed.score);
  assert.deepEqual(available.candlesDaily, failed.candlesDaily);
  assert.equal(failed.comparability?.dividends.status, "unavailable");
  const summary = missingDataSummary(failed);
  for (const id of ["history.adjustment", "history.financials", "security.basis", "dividends"]) assert.equal(summary.items.filter(i => i.id === id).length, 1);
  assert.equal(available.comparability?.security.type, "Common Stock");
  assert.equal(available.comparability?.security.adrRatio, null);
  assert.equal(buildComparability(failed.quote, null, unavailableDividends("AAPL")).security.epsCurrency, null);
});
