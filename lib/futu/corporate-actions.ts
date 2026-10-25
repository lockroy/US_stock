import type { DividendEvidence, ComparabilityEvidence, Quote, Financials } from "../types";
import { financialEnd } from "./sec";
import { normalizeTicker } from "./symbol";
import { parseFinancialNumber, NASDAQ_USER_AGENT } from "./nasdaq";

export type DividendProvider = (symbol: string) => Promise<DividendEvidence>;
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const date = (v: unknown) => typeof v === "string" ? financialEnd(v) : null;
export const dividendUrl = (symbol: string) => `https://api.nasdaq.com/api/quote/${encodeURIComponent(normalizeTicker(symbol) ?? "")}/dividends?assetclass=stocks`;
export function unavailableDividends(symbol: string): DividendEvidence {
  return { status: "unavailable", source: "nasdaq", url: dividendUrl(symbol), fetchedAt: Math.floor(Date.now() / 1000), events: [], rejectedRows: 0, completeness: "unknown", message: "股息資料未能讀取；不代表沒有派息。" };
}

// 列出供應商披露事件；空表不等於完整期間內沒有事件，$ 符號亦不推定 USD。
export function parseDividends(payload: unknown, symbol: string): DividendEvidence {
  const result = unavailableDividends(symbol);
  const root = object(payload), data = object(root?.data), table = object(data?.dividends);
  if (!normalizeTicker(symbol) || !Array.isArray(table?.rows)) return result;
  for (const row of table.rows) {
    const r = object(row), exDate = date(r?.exOrEffDate), amount = parseFinancialNumber(r?.amount);
    if (!r || !exDate || amount === null || amount < 0 || r.type !== "Cash") { result.rejectedRows++; continue; }
    const currency = typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null;
    result.events.push({ exDate, amount, currency, paymentDate: date(r.paymentDate), declarationDate: date(r.declarationDate) });
  }
  result.events.sort((a, b) => b.exDate.localeCompare(a.exDate));
  result.status = result.events.length ? "available" : result.rejectedRows ? "unavailable" : "none_reported";
  result.message = result.events.length ? "已讀取供應商現金股息記錄；公告或未來除淨日不等於已收取股息，歷史涵蓋完整度未知。"
    : result.rejectedRows ? "股息列格式或類別未能核對；不當作零派息。" : "供應商回傳空表；不代表已確認沒有派息。";
  return result;
}

export async function fetchDividends(symbol: string): Promise<DividendEvidence> {
  if (!normalizeTicker(symbol)) return unavailableDividends(symbol);
  try {
    const response = await fetch(dividendUrl(symbol), { headers: { Accept: "application/json", "User-Agent": NASDAQ_USER_AGENT }, signal: AbortSignal.timeout(8000), redirect: "manual", cache: "no-store" });
    if (!response.ok) return unavailableDividends(symbol);
    return parseDividends(await response.json(), symbol);
  } catch { return unavailableDividends(symbol); }
}

export function buildComparability(quote: Quote, financials: Financials | null, dividends: DividendEvidence): ComparabilityEvidence {
  return { dividends, priceAdjustment: "unverified", financialHistory: "latest_snapshot_only", security: {
    type: quote.securityType ?? null, exchange: quote.exchange ?? null,
    epsCurrency: financials?.epsEvidence?.unit === "USD/shares" ? "USD" : null,
    statementCurrency: null, adrRatio: null, shareClassVerified: false,
  } };
}

export const isDepositary = (type?: string | null) => !!type && /deposit[ao]ry|\bADR\b|\bADS\b/i.test(type);
