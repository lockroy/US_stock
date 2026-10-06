// 真實數據源：Nasdaq 公開 API（免 key、免帳號）
// 覆蓋：即時報價、歷史日線（OHLCV）、年度財務四表、市值/產業、ETF 大盤與產業趨勢。
// 不提供：分析師評級、個股新聞、日內分時（由上層標註並兜底）。
// 注意：此為非官方公開端點，已對每個請求加逾時與失敗回 null（上層 fallback）。
import type { Candle, Quote, Financials, Valuation } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 符號正規化：去 US. 前綴、大寫，Nasdaq 用純 ticker（AAPL / TSLA）
export function toTicker(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  return s.startsWith("US.") ? s.slice(3) : s;
}

function parseMoney(s: string | undefined | null): number {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[$,%]/g, "").replace(/,/g, "")) || 0;
}

function parseDateUS(s: string): number {
  // "08/28/2026" -> unix seconds (UTC)
  const [m, d, y] = s.split("/").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

// 表格工具：從 {value1..value5} rows 中按行名取值（v2=最新期，v3=去年同期）
function rowVal(rows: { value1: string; [k: string]: unknown }[], name: string, col: string): number {
  const r = rows.find((x) => x.value1 === name);
  if (!r) return 0;
  return parseMoney(r[col] as string);
}

export class QuoteLookupError extends Error {
  constructor(public code: "SYMBOL_NOT_FOUND" | "DATA_UNAVAILABLE") {
    super(code === "SYMBOL_NOT_FOUND" ? "找不到股票代號" : "行情服務暫時不可用，無法驗證股票代號");
  }
}

// 區分供應商明確拒絕代號與連線失敗，避免將網路故障誤報成不存在。
export async function fetchVerifiedQuote(symbol: string): Promise<Quote> {
  const ticker = toTicker(symbol);
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/info?assetclass=stocks`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
    );
    if (res.status === 400 || res.status === 404) throw new QuoteLookupError("SYMBOL_NOT_FOUND");
    if (!res.ok) throw new QuoteLookupError("DATA_UNAVAILABLE");
    const body = await res.json();
    if (!body?.data) {
      const message = JSON.stringify(body?.status?.bCodeMessage ?? "");
      const missing = /invalid (?:symbol|ticker)|(?:symbol|ticker).*(?:not found|does not exist)/i.test(message);
      throw new QuoteLookupError(missing ? "SYMBOL_NOT_FOUND" : "DATA_UNAVAILABLE");
    }
    const d = body.data;
    if (toTicker(d.symbol ?? "") !== ticker) throw new QuoteLookupError("DATA_UNAVAILABLE");
    const p = d.primaryData || {};
    const last = parseMoney(p.lastSalePrice);
    if (!Number.isFinite(last) || last <= 0) throw new QuoteLookupError("DATA_UNAVAILABLE");
    return {
      symbol: ticker,
      name: d.companyName || ticker,
      lastPrice: last,
      change: parseMoney(p.netChange?.replace(/^\+/, "")),
      changePct: parseFloat(String(p.percentageChange || "").replace(/[%+]/g, "")) || 0,
      volume: parseMoney(p.volume),
      timestamp: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    if (error instanceof QuoteLookupError) throw error;
    throw new QuoteLookupError("DATA_UNAVAILABLE");
  }
}

export async function fetchQuote(symbol: string): Promise<Quote | null> {
  try { return await fetchVerifiedQuote(symbol); } catch { return null; }
}

// 摘要資料：市值、產業、52 週區間（估值推導與產業趨勢用）
export interface NasdaqSummary {
  marketCap: number; // 美元
  sector: string | null;
  industry: string | null;
  oneYrTarget: number | null;
}
export async function fetchSummary(symbol: string): Promise<NasdaqSummary | null> {
  const ticker = toTicker(symbol);
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/quote/${ticker}/summary?assetclass=stocks`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const s = (await res.json())?.data?.summaryData;
    if (!s) return null;
    return {
      marketCap: parseMoney(s.MarketCap?.value),
      sector: (s.Sector?.value as string) || null,
      industry: (s.Industry?.value as string) || null,
      oneYrTarget: parseMoney(s.OneYrTarget?.value) || null,
    };
  } catch {
    return null;
  }
}

// 歷史日線（OHLCV）。days: 日曆天回推（400 日曆天 ≈ 275 交易日，確保 EMA200 有足夠數據）
export async function fetchDaily(symbol: string, days = 400): Promise<Candle[] | null> {
  const ticker = toTicker(symbol);
  try {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const url = `https://api.nasdaq.com/api/quote/${ticker}/historical?assetclass=stocks&fromdate=${fmt(from)}&todate=${fmt(to)}&limit=${days + 5}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const rows = (await res.json())?.data?.tradesTable?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const candles: Candle[] = rows
      .map((r: Record<string, string>) => ({
        time: parseDateUS(r.date),
        open: parseMoney(r.open),
        high: parseMoney(r.high),
        low: parseMoney(r.low),
        close: parseMoney(r.close),
        volume: parseMoney(r.volume),
      }))
      .filter((c: Candle) => c.time > 0 && c.close > 0)
      .sort((a: Candle, b: Candle) => a.time - b.time);
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
}

// ETF 歷史日線（SPY 大盤 / 產業 ETF），assetclass=etf
export async function fetchEtfDaily(etf: string, days = 130): Promise<Candle[] | null> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const url = `https://api.nasdaq.com/api/quote/${etf}/historical?assetclass=etf&fromdate=${fmt(from)}&todate=${fmt(to)}&limit=${days + 5}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const rows = (await res.json())?.data?.tradesTable?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const candles: Candle[] = rows
      .map((r: Record<string, string>) => ({
        time: parseDateUS(r.date),
        open: parseMoney(r.open),
        high: parseMoney(r.high),
        low: parseMoney(r.low),
        close: parseMoney(r.close),
        volume: parseMoney(r.volume),
      }))
      .filter((c: Candle) => c.time > 0 && c.close > 0)
      .sort((a: Candle, b: Candle) => a.time - b.time);
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
}

// 年度財務（income statement + ratios + cash flow + balance sheet）
// 全部數值推導自 Nasdaq 年報四表（單位：千美元，比率為 %）
export interface NasdaqFinancialsRaw {
  fin: Financials;
  revenue: number; // 千美元（最新財年）
  netIncome: number; // 千美元
  totalEquity: number; // 千美元
  totalDebt: number; // 千美元
  cash: number; // 千美元
}
export async function fetchFinancials(symbol: string): Promise<NasdaqFinancialsRaw | null> {
  const ticker = toTicker(symbol);
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/company/${ticker}/financials?frequency=1`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const d = (await res.json())?.data;
    if (!d || !d.incomeStatementTable?.rows) return null;

    const inc: { value1: string; [k: string]: unknown }[] = d.incomeStatementTable.rows;
    const cf: { value1: string; [k: string]: unknown }[] = d.cashFlowTable?.rows || [];
    const bs: { value1: string; [k: string]: unknown }[] = d.balanceSheetTable?.rows || [];
    const ratios: { value1: string; [k: string]: unknown }[] = d.financialRatiosTable?.rows || [];

    const revenue = rowVal(inc, "Total Revenue", "value2");
    const revenuePrev = rowVal(inc, "Total Revenue", "value3");
    const netIncome = rowVal(inc, "Net Income", "value2");
    const netIncomePrev = rowVal(inc, "Net Income", "value3");
    const opInc = rowVal(inc, "Operating Income", "value2");
    const ebt = rowVal(inc, "Earnings Before Tax", "value2");
    const tax = rowVal(inc, "Income Tax", "value2");

    const cfo = rowVal(cf, "Net Cash Flow-Operating", "value2");
    const capex = Math.abs(rowVal(cf, "Capital Expenditures", "value2"));
    const fcf = cfo - capex;

    const equity = rowVal(bs, "Total Equity", "value2");
    const stDebt = rowVal(bs, "Short-Term Debt / Current Portion of Long-Term Debt", "value2");
    const ltDebt = rowVal(bs, "Long-Term Debt", "value2");
    const cash = rowVal(bs, "Cash and Cash Equivalents", "value2") + rowVal(bs, "Short-Term Investments", "value2");
    const totalDebt = stDebt + ltDebt;

    const grossMargin = ratios.find((r) => r.value1 === "Gross Margin")
      ? parseMoney(ratios.find((r) => r.value1 === "Gross Margin")!.value2 as string)
      : revenue > 0 ? (rowVal(inc, "Gross Profit", "value2") / revenue) * 100 : 0;
    const roe = ratios.find((r) => r.value1 === "After Tax ROE")
      ? parseMoney(ratios.find((r) => r.value1 === "After Tax ROE")!.value2 as string)
      : equity > 0 ? (netIncome / equity) * 100 : 0;

    // ROIC = NOPAT / 投入資本（總債務 + 權益）；NOPAT = 營業利益 × (1 - 有效稅率)
    const taxRate = ebt > 0 ? Math.min(0.6, Math.max(0, tax / ebt)) : 0.21;
    const invested = totalDebt + equity;
    const roic = invested > 0 && opInc > 0 ? (opInc * (1 - taxRate) / invested) * 100 : 0;

    const fin: Financials = {
      revenueGrowth: revenuePrev > 0 ? ((revenue - revenuePrev) / revenuePrev) * 100 : 0,
      epsGrowth: netIncomePrev > 0 && netIncome > 0 ? ((netIncome - netIncomePrev) / netIncomePrev) * 100 : 0, // 淨利增長代理（Nasdaq 無 EPS 行）
      grossMargin,
      roe,
      roic,
      debtToEquity: equity > 0 ? totalDebt / equity : 99,
      fcf, // 千美元（絕對值）
    };
    return { fin, revenue, netIncome, totalEquity: equity, totalDebt, cash };
  } catch {
    return null;
  }
}

// 估值推導：市值（summary）+ 財務（financials）→ PE/PEG/PB/PS/FCF yield/EV-Sales
export function deriveValuation(marketCap: number, raw: NasdaqFinancialsRaw | null): Valuation | null {
  if (!raw || marketCap <= 0) return null;
  const { revenue, netIncome, totalEquity, totalDebt, cash, fin } = raw;
  const pe = netIncome > 0 ? marketCap / (netIncome * 1000) : null; // 千美元 → 美元
  const peg = pe != null && fin.epsGrowth > 0 ? pe / fin.epsGrowth : null;
  const pb = totalEquity > 0 ? marketCap / (totalEquity * 1000) : null;
  const ps = revenue > 0 ? marketCap / (revenue * 1000) : null;
  const fcfYield = fin.fcf > 0 ? (fin.fcf * 1000) / marketCap * 100 : null;
  const ev = marketCap + totalDebt * 1000 - cash * 1000;
  const evSales = revenue > 0 ? ev / (revenue * 1000) : null;
  return { pe, peg, pb, fcfYield, ps, evSales };
}

// 產業 → SPDR 產業 ETF 映射（相對強弱用）
const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK",
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  "Health Care": "XLV",
  "Healthcare": "XLV",
  Financials: "XLF",
  Finance: "XLF",
  Industrials: "XLI",
  Energy: "XLE",
  Materials: "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
};

// 大盤趨勢：SPY 現價 vs SMA50（多頭=true）
export async function fetchSpyTrend(): Promise<boolean | null> {
  const spy = await fetchEtfDaily("SPY", 130);
  if (!spy || spy.length < 55) return null;
  const closes = spy.map((c) => c.close);
  const last = closes[closes.length - 1];
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  return last > sma50;
}

// 產業相對強弱：產業 ETF 近 20 日報酬 > SPY 近 20 日報酬 → true
export async function fetchSectorStrength(sector: string | null): Promise<boolean | null> {
  if (!sector) return null;
  const etf = SECTOR_ETF[sector];
  if (!etf) return null;
  const [sectorCandles, spyCandles] = await Promise.all([
    fetchEtfDaily(etf, 60),
    fetchEtfDaily("SPY", 60),
  ]);
  if (!sectorCandles || !spyCandles || sectorCandles.length < 21 || spyCandles.length < 21) return null;
  const ret20 = (c: Candle[]) => {
    const closes = c.map((x) => x.close);
    return closes[closes.length - 1] / closes[closes.length - 21] - 1;
  };
  return ret20(sectorCandles) > ret20(spyCandles);
}

// 日內/分時：Nasdaq 免費接口無穩定分時，回傳 null 讓 caller 用日線降級
export async function fetchIntraday(): Promise<Candle[] | null> {
  return null;
}
