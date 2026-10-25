// 真實數據源：Nasdaq 公開 API（免 key、免帳號）
// 覆蓋：即時報價、歷史日線（OHLCV）、年度財務四表、市值/產業、ETF 大盤與產業趨勢。
// 不提供：分析師評級、個股新聞、日內分時（由上層標註未知）。
// 注意：此為非官方公開端點，已對每個請求加逾時與失敗回 null（上層保持未知）。
import type { Candle, Quote, Financials, Valuation, MarketCapSnapshot } from "../types";
import { validateCandles } from "../indicators/indicators";
import { financialEnd } from "./sec";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 符號正規化：去 US. 前綴、大寫，Nasdaq 用純 ticker（AAPL / TSLA）
export function toTicker(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  return s.startsWith("US.") ? s.slice(3) : s;
}

function parseDateUS(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) return null;
  const [m, d, y] = value.split("/").map(Number);
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? time / 1000 : null;
}

// 股票與 ETF 共用嚴格 OHLCV 解析，缺成交量不當作零，也不丟掉壞列後假裝完整。
export function parseHistoricalRows(rows: unknown): Candle[] | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    const time = parseDateUS(r.date);
    const open = parseFinancialNumber(r.open), high = parseFinancialNumber(r.high);
    const low = parseFinancialNumber(r.low), close = parseFinancialNumber(r.close), volume = parseFinancialNumber(r.volume);
    if (time === null || open === null || high === null || low === null || close === null || volume === null) return null;
    candles.push({ time, open, high, low, close, volume });
  }
  candles.sort((a, b) => a.time - b.time);
  try { validateCandles(candles); } catch { return null; }
  return candles;
}

// 財務使用嚴格解析：空白、N/A、缺欄位或非數字都保留未知。
export function parseFinancialNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.trim().replace(/[$,%\s]/g, "");
  if (/^\(.*\)$/.test(text)) text = "-" + text.slice(1, -1);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const result = Number(text);
  return Number.isFinite(result) ? result : null;
}

type FinancialRow = { value1?: unknown; [key: string]: unknown };
function rowVal(rows: FinancialRow[], name: string, col: string): number | null {
  return parseFinancialNumber(rows.find(row => row.value1 === name)?.[col]);
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
    const last = parseFinancialNumber(p.lastSalePrice);
    const volume = parseFinancialNumber(p.volume);
    if (last === null || !Number.isFinite(last) || last <= 0) throw new QuoteLookupError("DATA_UNAVAILABLE");
    return {
      symbol: ticker,
      name: d.companyName || ticker,
      lastPrice: last,
      change: parseFinancialNumber(p.netChange),
      changePct: parseFinancialNumber(p.percentageChange),
      volume: volume !== null && volume >= 0 ? volume : null,
      timestamp: null, // 供應商未提供已核對時區的 epoch，不以讀取時間冒充成交時間。
      asOf: typeof p.lastTradeTimestamp === "string" && p.lastTradeTimestamp.trim() && p.lastTradeTimestamp !== "N/A" ? p.lastTradeTimestamp : null,
      fetchedAt: Math.floor(Date.now() / 1000),
      isRealTime: typeof d.isRealTime === "boolean" ? d.isRealTime : null,
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
  marketCap: number | null; // 美元
  sector: string | null;
  industry: string | null;
  oneYrTarget: number | null;
  marketCapSnapshot?: MarketCapSnapshot;
}
export async function fetchSummary(symbol: string): Promise<NasdaqSummary | null> {
  const ticker = toTicker(symbol);
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/quote/${ticker}/summary?assetclass=stocks`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const s = (await res.json())?.data?.summaryData;
    if (!s) return null;
    const cap = parseFinancialNumber(s.MarketCap?.value);
    const marketCap = cap !== null && cap > 0 ? cap : null;
    return {
      marketCap,
      marketCapSnapshot: { value: marketCap, currency: "USD", source: "nasdaq", fetchedAt: Math.floor(Date.now() / 1000), asOf: null, refreshPolicy: "on-demand-no-store" },
      sector: (s.Sector?.value as string) || null,
      industry: (s.Industry?.value as string) || null,
      oneYrTarget: parseFinancialNumber(s.OneYrTarget?.value),
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

    return parseHistoricalRows(rows);
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
    return parseHistoricalRows(rows);
  } catch {
    return null;
  }
}

// 年度財務（income statement + ratios + cash flow + balance sheet）
// 全部數值推導自 Nasdaq 年報四表（單位：千美元，比率為 %）
export interface NasdaqFinancialsRaw {
  fin: Financials;
  revenue: number | null; // 千美元
  netIncome: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  cash: number | null;
}

const known = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const addKnown = (a: number | null, b: number | null) => known(a) && known(b) ? a + b : null;
const growthRate = (current: number | null, previous: number | null) =>
  known(current) && known(previous) && previous > 0 ? (current - previous) / previous * 100 : null;

export function parseFinancialData(data: unknown): NasdaqFinancialsRaw | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, { rows?: FinancialRow[]; headers?: Record<string, string> } | undefined>;
  const income = d.incomeStatementTable;
  if (!Array.isArray(income?.rows) || !income.rows.length) return null;
  const inc = income.rows;
  const periodEnd = income.headers?.value2;
  const previousPeriod = income.headers?.value3;
  const year = (date?: string) => date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date) ? Number(date.split("/")[2]) : null;
  const comparableYears = year(periodEnd) !== null && year(previousPeriod) !== null
    && year(periodEnd)! - year(previousPeriod)! === 1;
  // 缺少或不一致的表格日期不拼接成同一財年。
  const samePeriod = (key: string): FinancialRow[] => {
    const table = d[key];
    return periodEnd && table?.headers?.value2 === periodEnd && Array.isArray(table.rows) ? table.rows : [];
  };
  const cf = samePeriod("cashFlowTable");
  const bs = samePeriod("balanceSheetTable");
  const ratios = samePeriod("financialRatiosTable");
  const revenue = rowVal(inc, "Total Revenue", "value2");
  const revenuePrev = rowVal(inc, "Total Revenue", "value3");
  const netIncome = rowVal(inc, "Net Income", "value2");
  const netIncomePrev = rowVal(inc, "Net Income", "value3");
  const opInc = rowVal(inc, "Operating Income", "value2");
  const ebt = rowVal(inc, "Earnings Before Tax", "value2");
  const tax = rowVal(inc, "Income Tax", "value2");
  const cfo = rowVal(cf, "Net Cash Flow-Operating", "value2");
  const capex = rowVal(cf, "Capital Expenditures", "value2");
  const fcf = known(cfo) && known(capex) ? cfo - Math.abs(capex) : null;
  const equity = rowVal(bs, "Total Equity", "value2");
  const totalDebt = addKnown(rowVal(bs, "Short-Term Debt / Current Portion of Long-Term Debt", "value2"), rowVal(bs, "Long-Term Debt", "value2"));
  const cash = addKnown(rowVal(bs, "Cash and Cash Equivalents", "value2"), rowVal(bs, "Short-Term Investments", "value2"));
  const grossProfit = rowVal(inc, "Gross Profit", "value2");
  const grossMargin = rowVal(ratios, "Gross Margin", "value2")
    ?? (known(grossProfit) && known(revenue) && revenue > 0 ? grossProfit / revenue * 100 : null);
  const roe = rowVal(ratios, "After Tax ROE", "value2")
    ?? (known(netIncome) && known(equity) && equity > 0 ? netIncome / equity * 100 : null);
  const taxRate = known(ebt) && ebt > 0 && known(tax) ? tax / ebt : null;
  const invested = addKnown(totalDebt, equity);
  // 保留實際有效稅率，不套 21% 或夾限；負營業利益亦照實計算。
  const roic = known(taxRate) && known(opInc) && known(invested) && invested > 0
    ? opInc * (1 - taxRate) / invested * 100 : null;
  const fin: Financials = {
    revenueGrowth: comparableYears ? growthRate(revenue, revenuePrev) : null,
    epsGrowth: null,
    netIncomeGrowth: comparableYears ? growthRate(netIncome, netIncomePrev) : null,
    grossMargin, roe, roic,
    debtToEquity: known(totalDebt) && known(equity) && equity > 0 ? totalDebt / equity : null,
    fcf, periodEnd,
    notes: {
      epsGrowth: "此財務端點未提供已核對的每股盈利資料；EPS 增長未知，不以淨利增長代替。",
      netIncomeGrowth: "按本期與上期淨利計算，並非 EPS 增長；上期非正數時不計增長率。",
      revenueGrowth: "按本期與上期營收計算；上期非正數或缺值時不適用。",
      grossMargin: "優先使用披露毛利率；否則以毛利÷營收計算，缺輸入時未知。",
      roe: "優先使用披露 ROE；否則為淨利÷期末權益，並非平均權益 ROE。",
      roic: "簡化 ROIC＝營業利益×(1−實際有效稅率)÷期末(債務＋權益)，不是公司披露 ROIC；輸入不足或稅前盈利非正數時未知。",
      debtToEquity: "短期及長期債務÷期末權益；缺輸入或權益非正數時不適用。",
      fcf: "營運現金流−資本支出絕對值，單位為千美元；兩者必須有披露數值。",
    },
  };
  for (const key of ["revenueGrowth", "epsGrowth", "netIncomeGrowth", "grossMargin", "roe", "roic", "debtToEquity", "fcf"] as const) {
    if (!known(fin[key])) fin[key] = null;
  }
  if (![revenue, netIncome, equity, totalDebt, cash, fin.grossMargin, fin.roe, fcf].some(known)) return null;
  return { fin, revenue, netIncome, totalEquity: equity, totalDebt, cash };
}

export async function fetchFinancials(symbol: string): Promise<NasdaqFinancialsRaw | null> {
  try {
    const res = await fetch(`https://api.nasdaq.com/api/company/${encodeURIComponent(toTicker(symbol))}/financials?frequency=1`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return parseFinancialData((await res.json())?.data);
  } catch { return null; }
}

// 估值只使用已知、有限且適用的輸入，不把缺債務／現金視為零。
export function deriveValuation(marketCap: number | null, raw: NasdaqFinancialsRaw | null, snapshot?: MarketCapSnapshot): Valuation | null {
  if (!raw || !known(marketCap) || marketCap <= 0) return null;
  if (snapshot && snapshot.value !== marketCap) return null;
  const { revenue, netIncome, totalEquity, totalDebt, cash, fin } = raw;
  const pe = known(netIncome) && netIncome > 0 ? marketCap / (netIncome * 1000) : null;
  const evidence = fin.epsEvidence;
  const aligned = !!evidence && !!fin.periodEnd && financialEnd(fin.periodEnd) === evidence.currentEnd;
  const growth = evidence && known(evidence.current) && known(evidence.previous) && evidence.previous > 0
    ? (evidence.current - evidence.previous) / evidence.previous * 100 : null;
  const verifiedGrowth = evidence?.source === "sec" && evidence.metric === "EarningsPerShareDiluted"
    && evidence.unit === "USD/shares" && aligned && known(growth) && known(fin.epsGrowth)
    && Math.abs(growth - fin.epsGrowth) < 1e-8;
  const peg = pe !== null && verifiedGrowth && fin.epsGrowth! > 0 ? pe / fin.epsGrowth! : null;
  const pegMessage = !evidence ? "缺少 SEC 年度 EPS 證據，未計算 PEG。"
    : !aligned ? "Nasdaq 財年與 SEC EPS 財年不一致，未計算 PEG。"
    : !verifiedGrowth ? "EPS 增長不可用或與原始數值不一致，未計算 PEG。"
    : fin.epsGrowth! <= 0 ? "歷史 EPS 增長非正數，PEG 不適用。"
    : pe === null ? "缺少正數年度淨利，未計算 PEG。"
    : "僅按本次市值輸入與同財年 EPS 計算；市值更新時點尚未由供應商確認。";
  const pb = known(totalEquity) && totalEquity > 0 ? marketCap / (totalEquity * 1000) : null;
  const ps = known(revenue) && revenue > 0 ? marketCap / (revenue * 1000) : null;
  const fcfYield = known(fin.fcf) ? fin.fcf * 1000 / marketCap * 100 : null;
  const ev = known(totalDebt) && known(cash) ? marketCap + totalDebt * 1000 - cash * 1000 : null;
  const evSales = known(ev) && known(revenue) && revenue > 0 ? ev / (revenue * 1000) : null;
  const finite = (value: number | null) => known(value) ? value : null;
  return { pe: finite(pe), peg: finite(peg), pb: finite(pb), fcfYield: finite(fcfYield), ps: finite(ps), evSales: finite(evSales),
    pegBasis: "歷史年度 PEG＝市值／年度淨利 ÷ SEC 年度攤薄 EPS 同比增長百分點；不是 TTM 或分析師預期 PEG；增長非正數時不適用。",
    pegMessage, financialPeriodEnd: fin.periodEnd, annualNetIncomeUSD: known(netIncome) ? finite(netIncome * 1000) : null,
    ...(snapshot ? { marketCapSnapshot: snapshot } : {}) };
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
  if (!sectorCandles.slice(-21).every((c, i) => c.time === spyCandles.slice(-21)[i].time)) return null;
  const ret20 = (c: Candle[]) => {
    const closes = c.map((x) => x.close);
    return closes[closes.length - 1] / closes[closes.length - 21] - 1;
  };
  return ret20(sectorCandles) > ret20(spyCandles);
}

// 日內/分時：Nasdaq 免費接口無穩定分時，回傳 null，由上層標示未取得
export async function fetchIntraday(): Promise<Candle[] | null> {
  return null;
}
