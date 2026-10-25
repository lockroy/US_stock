import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFinancialNumber, parseFinancialData, deriveValuation, fetchFinancials } from "./nasdaq";
import { score, scoreFundamental } from "../scoring/scoring";
import { computeIndicators } from "../indicators/indicators";
import * as mock from "./mock";

const row = (name: string, current: string, previous = "0") => ({ value1: name, value2: current, value3: previous });
function fixture() {
  const headers = { value2: "9/30/2025", value3: "9/30/2024" };
  return {
    incomeStatementTable: { headers: { ...headers }, rows: [
      row("Total Revenue", "200", "100"), row("Net Income", "30", "20"), row("Gross Profit", "100"),
      row("Operating Income", "40"), row("Earnings Before Tax", "20"), row("Income Tax", "14"),
    ] },
    cashFlowTable: { headers: { ...headers }, rows: [row("Net Cash Flow-Operating", "20"), row("Capital Expenditures", "(4)")] },
    balanceSheetTable: { headers: { ...headers }, rows: [row("Total Equity", "100"), row("Short-Term Debt / Current Portion of Long-Term Debt", "20"), row("Long-Term Debt", "30"), row("Cash and Cash Equivalents", "5"), row("Short-Term Investments", "3")] },
    financialRatiosTable: { headers: { ...headers }, rows: [row("Gross Margin", "50%"), row("After Tax ROE", "30%")] },
  };
}

test("strict financial numbers preserve zero and negatives without coercing unavailable values", () => {
  for (const value of [null, undefined, "", " ", "N/A", "--", "NaN", "123wrong", Infinity, NaN]) assert.equal(parseFinancialNumber(value), null);
  assert.equal(parseFinancialNumber("0"), 0);
  assert.equal(parseFinancialNumber("($1,234.50)"), -1234.5);
  assert.equal(parseFinancialNumber("-46.5%"), -46.5);
});

test("EPS remains unknown while net-income growth is separately named and never used for PEG", () => {
  const raw = parseFinancialData(fixture())!;
  assert.equal(raw.fin.revenueGrowth, 100);
  assert.equal(raw.fin.netIncomeGrowth, 50);
  assert.equal(raw.fin.epsGrowth, null);
  assert.match(raw.fin.notes!.epsGrowth, /不以淨利增長代替/);
  assert.equal(deriveValuation(1_000_000, raw)!.peg, null);
});

test("ROIC uses actual 70% effective tax rate without a 60% cap or 21% assumption", () => {
  const raw = parseFinancialData(fixture())!;
  assert.ok(Math.abs(raw.fin.roic! - 8) < 1e-10);
  assert.equal(raw.fin.fcf, 16);
  assert.equal(raw.fin.debtToEquity, 0.5);
  const input = fixture();
  input.incomeStatementTable.rows = input.incomeStatementTable.rows.filter(r => r.value1 !== "Income Tax");
  assert.equal(parseFinancialData(input)!.fin.roic, null);
});

test("missing debt, cash and capex do not become zero or create derived valuation", () => {
  const input = fixture();
  input.balanceSheetTable.rows = input.balanceSheetTable.rows.filter(r => !["Long-Term Debt", "Short-Term Investments"].includes(r.value1));
  input.cashFlowTable.rows = input.cashFlowTable.rows.filter(r => r.value1 !== "Capital Expenditures");
  const raw = parseFinancialData(input)!;
  assert.equal(raw.totalDebt, null);
  assert.equal(raw.cash, null);
  assert.equal(raw.fin.fcf, null);
  assert.equal(raw.fin.debtToEquity, null);
  assert.equal(raw.fin.roic, null);
  const valuation = deriveValuation(1_000_000, raw)!;
  assert.equal(valuation.evSales, null);
  assert.equal(valuation.fcfYield, null);
  assert.ok(valuation.pe! > 0);
});

test("zero and negative equity produce an inapplicable debt ratio, never 99", () => {
  for (const equity of ["0", "-10", "N/A"]) {
    const input = fixture();
    input.balanceSheetTable.rows.find(r => r.value1 === "Total Equity")!.value2 = equity;
    const raw = parseFinancialData(input)!;
    assert.equal(raw.fin.debtToEquity, null);
    assert.equal(deriveValuation(1_000_000, raw)!.pb, null);
  }
});

test("disclosed zeros and negative FCF remain real observations instead of unknown", () => {
  const input = fixture();
  input.cashFlowTable.rows[0].value2 = "0";
  const raw = parseFinancialData(input)!;
  assert.equal(raw.fin.fcf, -4);
  assert.equal(deriveValuation(1_000_000, raw)!.fcfYield, -0.4);
  input.cashFlowTable.rows[1].value2 = "0";
  assert.equal(parseFinancialData(input)!.fin.fcf, 0);
});

test("mismatched fiscal years cannot be combined and growth requires consecutive years", () => {
  const input = fixture();
  input.balanceSheetTable.headers.value2 = "9/30/2024";
  input.cashFlowTable.headers.value2 = "9/30/2024";
  input.financialRatiosTable.headers.value2 = "9/30/2024";
  input.incomeStatementTable.headers.value3 = "9/30/2023";
  const raw = parseFinancialData(input)!;
  assert.equal(raw.fin.revenueGrowth, null);
  assert.equal(raw.fin.netIncomeGrowth, null);
  assert.equal(raw.totalEquity, null);
  assert.equal(raw.fin.roe, null);
  assert.equal(raw.fin.fcf, null);
  assert.equal(raw.fin.grossMargin, 50); // 同期損益表毛利與營收可推導
});

test("a loss is not silently replaced with zero growth", () => {
  const input = fixture();
  input.incomeStatementTable.rows.find(r => r.value1 === "Net Income")!.value2 = "-10";
  assert.equal(parseFinancialData(input)!.fin.netIncomeGrowth, -150);
  input.incomeStatementTable.rows.find(r => r.value1 === "Net Income")!.value3 = "0";
  assert.equal(parseFinancialData(input)!.fin.netIncomeGrowth, null);
});

test("partial fundamental factors reduce completeness and retain only known scores", () => {
  const fin = { ...mock.mockFinancials("AAPL"), revenueGrowth: 100, epsGrowth: null, roic: null, fcf: null, debtToEquity: null };
  const factors = scoreFundamental(fin).factors;
  assert.equal(factors[0].availableMax, 5);
  assert.equal(factors[0].score, 5);
  assert.equal(factors[2].availableMax, 0);
  assert.equal(factors[2].score, 0);
  const result = score({ financials: fin, valuation: mock.mockValuation("AAPL"), ratings: mock.mockRatings("AAPL"), indicators: computeIndicators(mock.mockDailyCandles("AAPL")), marketTrendUp: true, sectorStrong: true });
  assert.equal(result.completeness.percent, 81.67);
  assert.equal(result.tier, "已知項目評分（非完整總評）");
  assert.ok(result.completeness.missing.some(x => x.includes("EPS 增長")));
  assert.ok(Number.isFinite(result.total));
});

test("financial HTTP adapter preserves nulls in JSON and missing tables are unavailable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: fixture() });
  try {
    const raw = await fetchFinancials("AAPL");
    assert.equal(JSON.parse(JSON.stringify(raw)).fin.epsGrowth, null);
  } finally { globalThis.fetch = original; }
  assert.equal(parseFinancialData({}), null);
  assert.equal(parseFinancialData({ incomeStatementTable: { rows: [] } }), null);
  assert.equal(deriveValuation(Infinity, parseFinancialData(fixture())), null);
});
