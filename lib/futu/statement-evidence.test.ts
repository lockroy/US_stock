import assert from "node:assert/strict";
import { test } from "node:test";
import type { EpsEvidence } from "../types";
import { parseStatementFacts, reconcileStatements } from "./statement-evidence";
import { fetchFinancialsWithEps } from "./financial-source";
import { deriveValuation } from "./nasdaq";
import * as nasdaq from "./nasdaq";
import { score } from "../scoring/scoring";
import { computeIndicators } from "../indicators/indicators";
import * as mock from "./mock";

const evidence: EpsEvidence = { source: "sec", cik: "0000320193", accession: "0000320193-25-000079", form: "10-K", filed: "2025-10-31",
  current: 6, previous: 5, currentStart: "2024-10-01", currentEnd: "2025-09-30", previousStart: "2023-10-01", previousEnd: "2024-09-30",
  metric: "EarningsPerShareDiluted", unit: "USD/shares", url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json" };
const row = (val: number, instant = false, extra = {}) => ({ val, ...(instant ? {} : { start: evidence.currentStart }), end: evidence.currentEnd,
  accn: evidence.accession, form: evidence.form, filed: evidence.filed, fp: "FY", ...extra });
function fixture() {
  return { cik: 320193, facts: { "us-gaap": {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [row(200000)] } },
    NetIncomeLoss: { units: { USD: [row(30000)] } }, StockholdersEquity: { units: { USD: [row(100000, true)] } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [row(20000)] } },
    PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [row(4000)] } },
  } } };
}
const amounts = { revenue: 200, netIncome: 30, totalEquity: 100, fcf: 16 };
const reconcile = (data: unknown = fixture(), inputs = amounts) => reconcileStatements(parseStatementFacts(data, evidence), inputs);

test("financial checks use actual USD tags from the same filing, not the EPS currency", () => {
  const result = reconcile();
  assert.ok(result.checks.every(c => c.status === "matched" && c.differenceUSD === 0));
  assert.equal(result.scope, "selected_fields_same_filing");
  assert.equal(result.checks.find(c => c.key === "fcf")?.secUSD, 16000);
  assert.equal(reconcile({ ...fixture(), cik: 123 }).checks.every(c => c.status === "unavailable"), true);
});

test("other currency, quarter, filing, period and instant/duration mismatches cannot validate a number", () => {
  for (const replacement of [
    { units: { EUR: [row(30000)] } },
    { units: { USD: [row(30000, false, { start: "2025-07-01" })] } },
    { units: { USD: [row(30000, false, { accn: "0000320193-24-000079" })] } },
    { units: { USD: [row(30000, false, { end: "2025-09-27" })] } },
    { units: { USD: [row(30000, true)] } },
  ]) {
    const data = fixture();data.facts["us-gaap"].NetIncomeLoss = replacement as typeof data.facts["us-gaap"]["NetIncomeLoss"];
    assert.equal(reconcile(data).checks.find(c => c.key === "netIncome")?.status, "unavailable");
  }
});

test("conflicting aliases and invalid same-filing values cannot cherry-pick a match", () => {
  const data = fixture();
  data.facts["us-gaap"].NetIncomeLoss.units.USD.push(row(31000));
  assert.equal(reconcile(data).checks.find(c => c.key === "netIncome")?.status, "unavailable");
  const aliases = { ...fixture().facts["us-gaap"], Revenues: { units: { USD: [row(210000)] } } };
  assert.equal(reconcile({ cik: 320193, facts: { "us-gaap": aliases } }).checks[0].status, "unavailable");
  const invalid = fixture();invalid.facts["us-gaap"].NetIncomeLoss.units.USD.push(row(NaN));
  assert.equal(reconcile(invalid).checks.find(c => c.key === "netIncome")?.status, "unavailable");
});

test("zero and negative cash flow stay observed; source rounding has an explicit bounded tolerance", () => {
  const data = fixture();data.facts["us-gaap"].NetCashProvidedByUsedInOperatingActivities.units.USD = [row(0)];
  const result = reconcile(data, { ...amounts, fcf: -4 });
  assert.equal(result.checks.find(c => c.key === "fcf")?.status, "matched");
  assert.equal(result.checks.find(c => c.key === "fcf")?.secUSD, -4000);
  assert.equal(reconcile(fixture(), { ...amounts, revenue: 200.5 }).checks[0].status, "matched");
  assert.equal(reconcile(fixture(), { ...amounts, revenue: 200.501 }).checks[0].status, "mismatch");
});

const raw: nasdaq.NasdaqFinancialsRaw = { fin: { ...mock.mockFinancials("AAPL"), fcf: 16, periodEnd: "9/30/2025", epsGrowth: null }, revenue: 200, netIncome: 30, totalEquity: 100, totalDebt: 50, cash: 8 };
const provider: typeof nasdaq = { ...nasdaq, fetchFinancials: async () => raw };
const eps = { status: "ready" as const, evidence, growth: 20, message: "SEC", statementFacts: parseStatementFacts(fixture(), evidence) };

test("matched financial evidence preserves scores while contradictions suppress only dependent valuations", async () => {
  const matched = (await fetchFinancialsWithEps("AAPL", provider, async () => eps))!;
  assert.ok(matched.fin.statementChecks?.checks.every(c => c.status === "matched"));
  const indicators = computeIndicators(mock.mockDailyCandles("AAPL"));
  const inputs = { financials: matched.fin, valuation: deriveValuation(1000000, matched), ratings: null, indicators, marketTrendUp: null, sectorStrong: null };
  const withoutEvidence = { ...matched, fin: { ...matched.fin, statementChecks: undefined } };
  assert.deepEqual(score(inputs), score({ ...inputs, financials: withoutEvidence.fin, valuation: deriveValuation(1000000, withoutEvidence) }));
  const conflicting = fixture();conflicting.facts["us-gaap"].NetIncomeLoss.units.USD = [row(40000)];
  const enriched = (await fetchFinancialsWithEps("AAPL", provider, async () => ({ ...eps, statementFacts: parseStatementFacts(conflicting, evidence) })))!;
  const valuation = deriveValuation(1000000, enriched)!;
  assert.equal(valuation.pe, null);assert.equal(valuation.peg, null);assert.equal(valuation.annualNetIncomeUSD, null);
  assert.equal(valuation.pb, deriveValuation(1000000, matched)?.pb);
  assert.equal(enriched.fin.fcf, 16);
  assert.equal(raw.fin.statementChecks, undefined);
});

test("contradictory cash-flow totals remain traceable but cannot score as positive free cash flow", async () => {
  const conflicting = fixture();conflicting.facts["us-gaap"].NetCashProvidedByUsedInOperatingActivities.units.USD = [row(-20000)];
  const enriched = (await fetchFinancialsWithEps("AAPL", provider, async () => ({ ...eps, statementFacts: parseStatementFacts(conflicting, evidence) })))!;
  assert.equal(enriched.fin.fcf, null);
  assert.equal(enriched.fin.statementChecks?.checks.find(c => c.key === "fcf")?.providerThousands, 16);
  assert.equal(enriched.fin.statementChecks?.checks.find(c => c.key === "fcf")?.secUSD, -24000);
  assert.equal(deriveValuation(1000000, enriched)?.fcfYield, null);
  assert.equal(raw.fin.fcf, 16);
});
