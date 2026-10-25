import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAnnualEps, parseAnnualEps, parseEpsVersions, selectEpsVersion, resolveSecCik } from "./sec";
import { fetchFinancialsWithEps } from "./financial-source";
import { buildReport } from "./client";
import { getStockData } from "./data";
import * as nasdaq from "./nasdaq";
import * as mock from "./mock";

const cik = "0000320193";
const now = new Date("2026-10-24T12:00:00Z");
const entry = (start: string, end: string, val: number, extra = {}) => ({ start, end, val, accn: "0000320193-25-000079", filed: "2025-11-01", form: "10-K", fp: "FY", fy: 2025, ...extra });
function facts(rows = [entry("2024-10-01", "2025-09-30", 6), entry("2023-10-01", "2024-09-30", 5)]) {
  return { cik: 320193, facts: { "us-gaap": { EarningsPerShareDiluted: { units: { "USD/shares": rows } } } } };
}
const parse = (data: unknown = facts()) => parseAnnualEps(data, cik, "9/30/2025", now);

test("SEC exact ticker mapping rejects ambiguous CIKs and separate share classes", () => {
  const directory = { 0: { ticker: "AAPL", cik_str: 320193 }, 1: { ticker: "MSFT", cik_str: 789019 } };
  assert.equal(resolveSecCik(directory, "us.aapl"), cik);
  assert.equal(resolveSecCik(directory, "UNKNOWN"), null);
  assert.equal(resolveSecCik({ 0: { ticker: "AAPL", cik_str: -1 } }, "AAPL"), null);
  assert.equal(resolveSecCik({ ...directory, 2: { ticker: "AAPL.B", cik_str: 320193 } }, "AAPL"), null);
  assert.equal(resolveSecCik({ ...directory, 2: { ticker: "AAPL", cik_str: 320193 } }, "AAPL"), null);
});

test("annual diluted EPS uses comparable periods in one filing and retains SEC evidence", () => {
  const result = parse();
  assert.equal(result.status, "ready");
  assert.equal(result.growth, 20);
  assert.equal(result.evidence?.current, 6);
  assert.equal(result.evidence?.previous, 5);
  assert.equal(result.evidence?.filed, "2025-11-01");
  assert.equal(result.evidence?.unit, "USD/shares");
  assert.match(result.evidence!.url, /CIK0000320193\.json$/);
});

test("zero and negative EPS remain observations; nonpositive bases never invent a growth percentage", () => {
  for (const [current, previous, expected] of [[0, 5, -100], [-1, 5, -120], [5, 0, null], [5, -1, null], [0, 0, null]] as const) {
    const result = parse(facts([entry("2024-10-01", "2025-09-30", current), entry("2023-10-01", "2024-09-30", previous)]));
    assert.equal(result.status, "ready");
    assert.equal(result.evidence?.current, current);
    assert.equal(result.growth, expected);
  }
});

test("quarterly, currency, fiscal-date, company and form mismatches cannot supply annual EPS", () => {
  for (const data of [
    facts([entry("2025-07-01", "2025-09-30", 2), entry("2024-07-01", "2024-09-30", 1)]),
    facts([entry("2024-10-01", "2025-09-30", 6, { form: "10-Q" }), entry("2023-10-01", "2024-09-30", 5)]),
    facts([entry("2024-10-01", "2025-09-30", NaN), entry("2023-10-01", "2024-09-30", 5)]),
    { ...facts(), cik: 789019 },
    { cik: 320193, facts: { "us-gaap": { EarningsPerShareBasic: facts().facts["us-gaap"].EarningsPerShareDiluted } } },
    { cik: 320193, facts: { "us-gaap": { EarningsPerShareDiluted: { units: { "EUR/shares": facts().facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"] } } } } },
  ]) assert.equal(parse(data).growth, null);
  assert.equal(parseAnnualEps(facts(), cik, "9/30/2024", now).growth, null);
  assert.equal(parseAnnualEps(facts(), cik, "2/30/2025", now).growth, null);
});

test("different filings, conflicting contexts and future filings are never mixed", () => {
  const pair = facts().facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"];
  assert.equal(parse(facts([pair[0], { ...pair[1], accn: "0000320193-24-000079" }])).growth, null);
  assert.equal(parse(facts([...pair, { ...pair[0], val: 7 }])).growth, null);
  assert.equal(parseAnnualEps(facts(), cik, "9/30/2025", new Date("2025-10-31T00:00:00Z")).growth, null);
  assert.equal(parse(facts([...pair, { ...pair[0], accn: "0000320193-26-000001", filed: "2026-01-01", val: 7 }])).growth, null);
  assert.equal(parse(facts([...pair, { ...pair[0], accn: "0000320193-26-000001", filed: "2026-01-01", val: NaN }])).growth, null);
  assert.equal(parse(facts([...pair, { ...pair[0], accn: "0000320193-25-000080" }])).growth, null);
});

test("a restatement uses both comparative values from the same latest filing", () => {
  const pair = facts().facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"];
  const updated = pair.map(r => ({ ...r, val: r.end === "2025-09-30" ? 12 : 10, accn: "0000320193-26-000001", filed: "2026-01-01", form: "10-K/A" }));
  const result = parse(facts([...pair, ...updated]));
  assert.equal(result.growth, 20);
  assert.equal(result.evidence?.current, 12);
  assert.equal(result.evidence?.previous, 10);
  assert.equal(result.evidence?.form, "10-K/A");
});

test("EPS history preserves original and amended pairs without using a same-day filing", () => {
  const pair = facts().facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"];
  const amended = pair.map(r => ({ ...r, val: r.end === "2025-09-30" ? 12 : 8, accn: "0000320193-26-000001", filed: "2026-01-01", form: "10-K/A" }));
  const versions = parseEpsVersions(facts([...pair, ...amended]), cik, "9/30/2025", now);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].growth, 20);
  assert.equal(versions[1].growth, 50);
  assert.equal(selectEpsVersion(versions, "2025-11-01"), null);
  assert.equal(selectEpsVersion(versions, "2025-11-02")?.current, 6);
  assert.equal(selectEpsVersion(versions, "2026-01-01")?.growth, 20);
  assert.equal(selectEpsVersion(versions, "2026-01-02")?.growth, 50);
  assert.equal(parseEpsVersions(facts([...pair, ...amended]), cik, "9/30/2025", new Date("2025-12-31T23:59:59Z")).length, 1);
  assert.deepEqual(parseEpsVersions({ ...facts(), cik: 123 }, cik, "9/30/2025", now), []);
});

test("an incomplete or ambiguous newer EPS version cannot fall back to older history", () => {
  const pair = facts().facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"];
  for (const newer of [
    [{ ...pair[0], val: NaN, accn: "0000320193-26-000001", filed: "2026-01-01", form: "10-K/A" }],
    pair.flatMap(r => ["0000320193-26-000001", "0000320193-26-000002"].map(accn => ({ ...r, accn, filed: "2026-01-01", form: "10-K/A" }))),
  ]) {
    const versions = parseEpsVersions(facts([...pair, ...newer]), cik, "9/30/2025", now);
    assert.equal(selectEpsVersion(versions, "2025-12-31")?.growth, 20);
    assert.equal(selectEpsVersion(versions, "2026-01-02"), null);
    assert.equal(versions.at(-1)?.status, "incomparable");
  }
});

test("explicit depositary securities never borrow issuer EPS without a verified ratio", async () => {
  let calls = 0;
  for (const type of ["American Depositary Shares", "American Depository Receipt", "ADR", "ADS"]) {
    const result = await fetchFinancialsWithEps("AAPL", provider, async () => { calls++; return parse(); }, type);
    assert.equal(result?.fin.epsGrowth, null);
    assert.equal(result?.fin.epsEvidence, undefined);
    assert.equal(result?.fin.fcf, raw.fin.fcf);
    assert.match(result!.fin.notes!.epsGrowth, /ADR／ADS/);
  }
  assert.equal(calls, 0);
  const options = { realData: true, provider: { ...provider, fetchVerifiedQuote: async () => ({ ...mock.mockQuote("AAPL"), securityType: "American Depositary Shares" }) },
    epsProvider: async () => { calls++; return parse(); },
    newsProvider: async () => ({ data: [], source: "unknown" as const, status: "disabled" as const, message: "新聞暫停" }) };
  assert.equal((await buildReport("AAPL", options)).financials?.epsEvidence, undefined);
  assert.equal(((await getStockData("financials", "AAPL", "day", options)).data as { epsGrowth: number | null }).epsGrowth, null);
  assert.equal(((await getStockData("valuation", "AAPL", "day", options)).data as { peg: number | null }).peg, null);
  assert.equal(calls, 0);
});

test("missing contact identification makes no SEC request; failures remain unknown without leaking headers", async () => {
  const originalFetch = globalThis.fetch, originalUA = process.env.SEC_USER_AGENT;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error("secret-header-error"); };
    delete process.env.SEC_USER_AGENT;
    assert.equal((await fetchAnnualEps("AAPL", "9/30/2025")).status, "not_configured");
    assert.equal(calls, 0);
    process.env.SEC_USER_AGENT = "test contact@example.com";
    const result = await fetchAnnualEps("AAPL", "9/30/2025");
    assert.equal(result.status, "unavailable");
    assert.equal(result.growth, null);
    assert.doesNotMatch(JSON.stringify(result), /secret-header-error|contact@example/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUA === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = originalUA;
  }
});

test("SEC fetch uses the configured identification and only the matched CIK endpoint", async () => {
  const originalFetch = globalThis.fetch, originalUA = process.env.SEC_USER_AGENT;
  const urls: string[] = [];
  try {
    process.env.SEC_USER_AGENT = "test contact@example.com";
    globalThis.fetch = async (input, init) => {
      urls.push(String(input));
      assert.equal(new Headers(init?.headers).get("User-Agent"), "test contact@example.com");
      assert.equal(init?.redirect, "manual");
      return Response.json(urls.length === 1 ? { 0: { ticker: "AAPL", cik_str: 320193 } } : facts());
    };
    const result = await fetchAnnualEps("US.AAPL", "9/30/2025");
    assert.equal(result.growth, 20);
    assert.equal(result.versions?.[0].usableFromDate, "2025-11-02");
    assert.deepEqual(urls, ["https://www.sec.gov/files/company_tickers.json", `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUA === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = originalUA;
  }
});

const raw: nasdaq.NasdaqFinancialsRaw = { fin: { ...mock.mockFinancials("AAPL"), epsGrowth: null, periodEnd: "9/30/2025" }, revenue: 200, netIncome: 30, totalEquity: 100, totalDebt: 50, cash: 8 };
const provider: typeof nasdaq = { ...nasdaq,
  fetchVerifiedQuote: async () => mock.mockQuote("AAPL"), fetchDaily: async () => mock.mockDailyCandles("AAPL"),
  fetchFinancials: async () => raw, fetchSummary: async () => ({ marketCap: 1_000_000, sector: null, industry: null, oneYrTarget: null }),
  fetchSpyTrend: async () => null, fetchSectorStrength: async () => null,
};

test("report, financials and valuation routes share SEC EPS, fiscal basis and historical PEG", async () => {
  const options = { realData: true, provider, epsProvider: async () => parse(),
    newsProvider: async () => ({ data: [], source: "unknown" as const, status: "disabled" as const, message: "新聞暫停" }) };
  const report = await buildReport("AAPL", options);
  const financials = await getStockData("financials", "AAPL", "day", options);
  const valuation = await getStockData("valuation", "AAPL", "day", options);
  assert.equal(report.financials?.epsGrowth, 20);
  assert.deepEqual(financials.data, report.financials);
  assert.equal(financials.sources?.epsGrowth, "sec");
  assert.equal(report.sources.epsGrowth, "sec");
  const model = nasdaq.deriveValuation(1_000_000, { ...raw, fin: report.financials! })!;
  assert.deepEqual(valuation.data, model);
  assert.equal(model.peg, model.pe! / 20);
  assert.match(model.pegBasis!, /不是 TTM 或分析師預期/);
  assert.equal(report.score.factors.find(f => f.sub === "PEG")?.available, true);
  assert.equal(raw.fin.epsGrowth, null); // 不污染快取或其他請求
});

test("SEC unavailable and nonpositive EPS growth preserve unknown PEG and other financial fields", async () => {
  const failed = await fetchFinancialsWithEps("AAPL", provider, async () => ({ status: "unavailable", growth: null, message: "SEC unavailable" }));
  assert.equal(failed?.fin.epsGrowth, null);
  assert.equal(failed?.fin.fcf, raw.fin.fcf);
  for (const growth of [0, -10]) {
    const data = { ...raw, fin: { ...raw.fin, epsGrowth: growth, epsEvidence: parse().evidence } };
    assert.equal(nasdaq.deriveValuation(1_000_000, data)?.peg, null);
  }
  assert.equal(nasdaq.deriveValuation(1_000_000, { ...raw, fin: { ...raw.fin, epsGrowth: 20 } })?.peg, null);
});

test("period mismatches cannot attach EPS evidence or produce a historical PEG", async () => {
  const shifted = { ...parse().evidence!, currentEnd: "2025-09-27" };
  const enriched = await fetchFinancialsWithEps("AAPL", provider, async () => ({ ...parse(), evidence: shifted }));
  assert.equal(enriched?.fin.epsGrowth, null);
  assert.equal(enriched?.fin.epsEvidence, undefined);
  assert.match(enriched!.fin.notes!.epsGrowth, /不一致/);
  const mismatched = nasdaq.deriveValuation(1_000_000, { ...raw, fin: { ...raw.fin, epsGrowth: 20, epsEvidence: shifted } })!;
  assert.equal(mismatched.peg, null);
  assert.match(mismatched.pegMessage!, /財年不一致/);
  const wrongGrowth = nasdaq.deriveValuation(1_000_000, { ...raw, fin: { ...raw.fin, epsGrowth: 200, epsEvidence: parse().evidence } })!;
  assert.equal(wrongGrowth.peg, null);
  assert.match(wrongGrowth.pegMessage!, /原始數值不一致/);
  const inconsistent = await fetchFinancialsWithEps("AAPL", provider, async () => ({ ...parse(), growth: 200 }));
  assert.equal(inconsistent?.fin.epsGrowth, null);
  assert.equal(inconsistent?.fin.epsEvidence, undefined);
});

test("summary explicitly avoids caching and distinguishes read time from unknown market-cap update time", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.cache, "no-store");
      return Response.json({ data: { summaryData: { MarketCap: { value: "1,000,000" } } } });
    };
    const summary = await nasdaq.fetchSummary("AAPL");
    assert.equal(summary?.marketCap, 1_000_000);
    assert.equal(summary?.marketCapSnapshot?.asOf, null);
    assert.equal(summary?.marketCapSnapshot?.refreshPolicy, "on-demand-no-store");
    assert.ok(Number.isFinite(summary?.marketCapSnapshot?.fetchedAt));
    globalThis.fetch = async () => Response.json({ data: { summaryData: { MarketCap: { value: "-1" } } } });
    assert.equal((await nasdaq.fetchSummary("AAPL"))?.marketCap, null);
  } finally { globalThis.fetch = originalFetch; }
});
