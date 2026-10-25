import { normalizeTicker } from "./symbol";
import type { StockReport, Candle, Financials, Valuation, Ratings, NewsItem, Quote, DataSource, MarketCapSnapshot } from "../types";
import { computeIndicators } from "../indicators/indicators";
import { score } from "../scoring/scoring";
import { buildMemo, buildRules, audit, findBuyPoints } from "../fable/fable";
import { assessStrategy } from "../fable/strategy";
import * as mock from "./mock";
import * as nasdaq from "./nasdaq";
import { getNews } from "../news/provider";
import type { NewsProvider, NewsResult } from "../news/types";
import { searchDirectory } from "./directory";
import { normalizeSearchQuery } from "./symbol";
import { fetchFinancialsWithEps } from "./financial-source";
import type { EpsProvider } from "./sec";
import { calendarSnapshot } from "../market/calendar";
import { quoteDay } from "../fable/timeliness";
import { fetchDividends, unavailableDividends, buildComparability, type DividendProvider } from "./corporate-actions";

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
  newsProvider?: NewsProvider;
  directorySearch?: typeof searchDirectory;
  epsProvider?: EpsProvider;
  dividendProvider?: DividendProvider;
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
  let marketCap: MarketCapSnapshot | null = null;
  let ratings: Ratings | null;
  let news: NewsItem[];
  let newsResult: NewsResult | undefined;
  let marketTrendUp: boolean | null = null;
  let sectorStrong: boolean | null = null;
  let dividends;

  if (real) {
    quote = verifiedQuote;
    const [candles, summary, finRaw, spyTrend, fetchedNews, fetchedDividends] = await Promise.all([
      provider.fetchDaily(symbol), provider.fetchSummary(symbol),
      fetchFinancialsWithEps(symbol, provider, options.epsProvider, quote.securityType), provider.fetchSpyTrend(),
      getNews(symbol, options.newsProvider),
      // 測試替代 provider 時不意外呼叫真實網路；明確 provider 可注入公司行動資料。
      (options.dividendProvider ?? (options.provider ? async () => unavailableDividends(symbol) : fetchDividends))(symbol)
        .catch(() => unavailableDividends(symbol)),
    ]);
    if (!candles || candles.length < 200) {
      throw new ReportError("DATA_UNAVAILABLE", "有效日線不足 200 根，暫時無法產生報告");
    }
    daily = candles;
    financials = finRaw?.fin ?? null;
    marketCap = summary?.marketCapSnapshot ?? null;
    valuation = summary && finRaw ? provider.deriveValuation(summary.marketCap, finRaw, summary.marketCapSnapshot) : null;
    ratings = null;
    newsResult = fetchedNews;
    news = newsResult.data;
    dividends = fetchedDividends;
    marketTrendUp = spyTrend;
    sectorStrong = summary ? await provider.fetchSectorStrength(summary.sector) : null;
    sources.quote = sources.candlesDaily = "nasdaq";
    sources.financials = financials ? "nasdaq" : "unknown";
    sources.epsGrowth = financials?.epsEvidence ? "sec" : "unknown";
    sources.valuation = valuation ? "derived" : "unknown";
    sources.marketCap = summary?.marketCap != null && summary.marketCap > 0 ? "nasdaq" : "unknown";
    sources.ratings = "unknown";
    sources.news = newsResult.source;
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
  const assessedAt = new Date();
  const strategy = assessStrategy(scoreResult, daily, quote, assessedAt);
  const plan = strategy.technical.referencePlan;
  const intraday = real ? [] : mock.mockIntradayCandles(symbol);
  sources.candlesIntraday = real ? "unknown" : "mock";
  sources.indicators = sources.scoring = "derived";
  return {
    quote, mode: real ? "real" : "demo", score: scoreResult, strategy, financials, valuation, marketCap,
    ...(real && dividends ? { comparability: buildComparability(quote, financials, dividends) } : {}),
    memo, rules: buildRules(memo), plan, audit: audit(scoreResult, memo, plan),
    buyPoints: findBuyPoints(daily, assessedAt), news, newsStatus: newsResult?.status, newsMessage: newsResult?.message, newsFetchedAt: newsResult?.fetchedAt,
    timing: { calendar: calendarSnapshot(assessedAt), quoteDate: quoteDay(quote),
      lastAvailableDailyDate: daily.length ? new Date(daily[daily.length - 1].time * 1000).toISOString().slice(0, 10) : null,
      lastClosedDailyDate: strategy.technical.evaluatedBarTime === null ? null : new Date(strategy.technical.evaluatedBarTime * 1000).toISOString().slice(0, 10) },
    candlesDaily: daily, candlesIntraday: intraday, sources,
  };
}

export async function searchSymbols(q: string, options: ReportOptions = {}) {
  const real = options.realData ?? process.env.REAL_DATA !== "false";
  try { normalizeSearchQuery(q); }
  catch { throw new ReportError("INVALID_SYMBOL", "搜尋內容無效，請輸入股票代號或公司名稱（最多 100 字）"); }
  if (!real) return mock.mockSearch(q.trim());
  try { return await (options.directorySearch ?? searchDirectory)(q); }
  catch { throw new ReportError("DATA_UNAVAILABLE", "股票搜尋服務暫時不可用，請稍後再試"); }
}
