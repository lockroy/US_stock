import type * as nasdaq from "./nasdaq";
import { fetchAnnualEps, financialEnd, type EpsProvider } from "./sec";
import { isDepositary } from "./corporate-actions";
import { reconcileStatements } from "./statement-evidence";

// 報告及獨立 financials／valuation 端點共用，不讓兩條路徑計出不同 EPS／PEG。
export async function fetchFinancialsWithEps(symbol: string, provider: typeof nasdaq, epsProvider: EpsProvider = fetchAnnualEps, securityType?: string | null) {
  const raw = await provider.fetchFinancials(symbol);
  if (!raw?.fin.periodEnd) return raw;
  if (isDepositary(securityType)) return { ...raw, fin: { ...raw.fin, epsGrowth: null, epsEvidence: undefined, epsHistory: undefined,
    notes: { ...raw.fin.notes, epsGrowth: "供應商標示存託證券；ADR／ADS 換算比率與每股口徑未核實，不直接套用發行人 EPS。" } } };
  let result;
  try { result = await epsProvider(symbol, raw.fin.periodEnd); }
  catch { return raw; }
  const fin = { ...raw.fin, notes: { ...raw.fin.notes } };
  if (result.versions) fin.epsHistory = result.versions;
  fin.notes.epsGrowth = `${raw.fin.notes?.epsGrowth ?? ""} ${result.message}`.trim();
  if (result.statementFacts && financialEnd(raw.fin.periodEnd) === result.statementFacts.evidence.currentEnd) {
    fin.statementChecks = reconcileStatements(result.statementFacts, { revenue: raw.revenue, netIncome: raw.netIncome, totalEquity: raw.totalEquity, fcf: raw.fin.fcf });
    if (fin.statementChecks.checks.some(c => c.key === "fcf" && c.status === "mismatch")) {
      fin.fcf = null;
      fin.notes.fcf = "Nasdaq 與同申報 SEC 自由現金流口徑／金額有差異；原始輸入保留在交叉核對表，暫不採用矛盾值評分，亦不換成零。";
    }
  }
  if (result.status === "ready" && result.evidence) {
    const e = result.evidence;
    const expected = Number.isFinite(e.current) && Number.isFinite(e.previous) && e.previous > 0
      ? (e.current - e.previous) / e.previous * 100 : null;
    const matches = expected === null ? result.growth === null
      : Number.isFinite(expected) && typeof result.growth === "number" && Number.isFinite(result.growth)
        && Math.abs(expected - result.growth) < 1e-8;
    if (financialEnd(raw.fin.periodEnd) !== result.evidence.currentEnd) {
      fin.epsGrowth = null;
      delete fin.epsEvidence;
      delete fin.epsHistory;
      fin.notes.epsGrowth = `Nasdaq 財年 ${raw.fin.periodEnd} 與 SEC EPS 財年 ${result.evidence.currentEnd} 不一致，不自動合併相近日期。`;
    } else if (!matches) {
      fin.epsGrowth = null;
      delete fin.epsEvidence;
      fin.notes.epsGrowth = "EPS 增長與原始每股數字不一致，保持未知，不影響其他已取得財務。";
    } else {
      fin.epsGrowth = result.growth;
      fin.epsEvidence = result.evidence;
      fin.notes.epsGrowth = result.message;
    }
  }
  return { ...raw, fin };
}
