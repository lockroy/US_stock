import type * as nasdaq from "./nasdaq";
import { fetchAnnualEps, financialEnd, type EpsProvider } from "./sec";

// 報告及獨立 financials／valuation 端點共用，不讓兩條路徑計出不同 EPS／PEG。
export async function fetchFinancialsWithEps(symbol: string, provider: typeof nasdaq, epsProvider: EpsProvider = fetchAnnualEps) {
  const raw = await provider.fetchFinancials(symbol);
  if (!raw?.fin.periodEnd) return raw;
  let result;
  try { result = await epsProvider(symbol, raw.fin.periodEnd); }
  catch { return raw; }
  const fin = { ...raw.fin, notes: { ...raw.fin.notes } };
  fin.notes.epsGrowth = `${raw.fin.notes?.epsGrowth ?? ""} ${result.message}`.trim();
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
