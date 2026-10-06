import { normalizeTicker } from "./symbol";
import type { StockReport, Candle, Financials, Valuation, Ratings, NewsItem, Quote, DataSource } from "../types";
import { computeIndicators } from "../indicators/indicators";
import { score } from "../scoring/scoring";
import { buildMemo, buildPlan, buildRules, audit, findBuyPoints } from "../fable/fable";
import * as mock from "./mock";
import * as nasdaq from "./nasdaq";

export class ReportError extends Error {
  constructor(public code: "INVALID_SYMBOL" | "INVALID_RANGE" | "SYMBOL_NOT_FOUND" | "DATA_UNAVAILABLE", message: string) {
    super(message);
  }
  get status() { return (this.code === "INVALID_SYMBOL" || this.code === "INVALID_RANGE") ? 400 : this.code === "SYMBOL_NOT_FOUND" ? 404 : 503; }
}

export function normalizeSymbol(raw: string): string {
  const ticker = normalizeTicker(raw);
  if (!ticker) throw new ReportError("INVALID_SYMBOL", "股票代號格式無效");
  return `US.${ticker}`;
}

export function hasFutuCreds(): boolean {
  return !!process.env.FUTU_CLIENT_ID && !!process.env.FUTU_CLIENT_SECRET;
}

export interface ReportOptions {
  realData?: boolean;
  provider?: typeof nasdaq;
}

// 所有股票資料入口共用模式、代號與存在性驗證。
export async function getDataContext(rawSymbol: string, options: ReportOptions = {}) {
  const symbol = normalizeSymbol(rawSymbol);
  const mode: "real" | "demo" = (options.realData ?? process.env.REAL_DATA !== "false") ? "real" : "demo";
  const provider = options.provider ?? nasdaq;
  if (mode === "demo") return { symbol, mode, provider, quote: mock.mockQuote(symbol) };
  try { return { symbol, mode, provider, quote: await provider.fetchVerifiedQuote(symbol) }; }
  catch (error) {
    if (error instanceof nasdaq.QuoteLookupError) throw new ReportError(error.code, error.message);
    throw new ReportError("DATA_UNAVAILABLE", "行情服務暫時不可用，無法驗證股票代號");
  }
}

// 真實模式不以模擬資料補缺；REAL_DATA=false 是明確的示範模式。
export async function buildReport(rawSymbol: string, options: ReportOptions = {}): Promise<StockReport> {
  const { symbol, mode, provider, quote: verifiedQuote } = await getDataContext(rawSymbol, options);
  const real = mode === "real";
  const sources: Record<string, DataSource> = {};
  let quote: Quote;
  let daily: Candle[];
  let financials: Financials | null;
  let valuation: Valuation | null;
  let ratings: Ratings | null;
  let news: NewsItem[];
  let marketTrendUp: boolean | null = null;
  let sectorStrong: boolean | null = null;

  if (real) {
    quote = verifiedQuote;
    const [candles, summary, finRaw, spyTrend] = await Promise.all([
      provider.fetchDaily(symbol), provider.fetchSummary(symbol),
      provider.fetchFinancials(symbol), provider.fetchSpyTrend(),
    ]);
    if (!candles || candles.length < 200) {
      throw new ReportError("DATA_UNAVAILABLE", "有效日線不足 200 根，暫時無法產生報告");
    }
    daily = candles;
    financials = finRaw?.fin ?? null;
    valuation = summary && finRaw ? provider.deriveValuation(summary.marketCap, finRaw) : null;
    ratings = null;
    news = [];
    marketTrendUp = spyTrend;
    sectorStrong = summary ? await provider.fetchSectorStrength(summary.sector) : null;
    sources.quote = sources.candlesDaily = "nasdaq";
    sources.financials = financials ? "nasdaq" : "unknown";
    sources.valuation = valuation ? "derived" : "unknown";
    sources.ratings = sources.news = "unknown";
    sources.marketTrendUp = marketTrendUp === null ? "unknown" : "nasdaq";
    sources.sectorStrong = sectorStrong === null ? "unknown" : "nasdaq";
  } else {
    quote = verifiedQuote;
    daily = mock.mockDailyCandles(symbol);
    financials = mock.mockFinancials(symbol);
    valuation = mock.mockValuation(symbol);
    ratings = mock.mockRatings(symbol);
    news = mock.mockNews(symbol);
    for (const key of ["quote", "candlesDaily", "financials", "valuation", "ratings", "news"]) sources[key] = "mock";
    sources.marketTrendUp = sources.sectorStrong = "unknown";
  }
  let indicators;
  try { indicators = computeIndicators(daily); }
  catch {
    throw new ReportError("DATA_UNAVAILABLE", "日線資料格式無效，暫時無法產生報告");
  }
  const scoreResult = score({ financials, valuation, ratings, indicators, marketTrendUp, sectorStrong });
  const memo = buildMemo(indicators, daily);
  const plan = buildPlan(indicators, daily);
  // 入場參考以本次報價為準，不混用上一次日線收盤價。
  plan.entry = quote.lastPrice;
  const intraday = real ? [] : mock.mockIntradayCandles(symbol);
  sources.candlesIntraday = real ? "unknown" : "mock";
  sources.indicators = sources.scoring = "derived";
  return {
    quote, mode: real ? "real" : "demo", score: scoreResult,
    memo, rules: buildRules(memo), plan, audit: audit(scoreResult, memo, plan),
    buyPoints: findBuyPoints(daily), news, candlesDaily: daily, candlesIntraday: intraday, sources,
  };
}

export async function searchSymbols(q: string, options: ReportOptions = {}) {
  const real = options.realData ?? process.env.REAL_DATA !== "false";
  if (!real) return mock.mockSearch(q.trim());
  try {
    const { symbol, quote } = await getDataContext(q, options);
    return [{ symbol, name: quote.name, type: "STOCK" }];
  } catch (error) {
    if (error instanceof ReportError && error.code === "SYMBOL_NOT_FOUND") return [];
    throw error;
  }
}
