import type { StockReport, Candle, Financials, Valuation, Ratings, NewsItem, Quote, DataSource } from "../types";
import { computeIndicators } from "../indicators/indicators";
import { score } from "../scoring/scoring";
import { buildMemo, buildPlan, buildRules, audit, findBuyPoints } from "../fable/fable";
import * as mock from "./mock";
import * as nasdaq from "./nasdaq";

// 真實數據開關：預設啟用 Nasdaq 公開源；設 REAL_DATA=false 可強制回 mock
const REAL_DATA = (process.env.REAL_DATA ?? "true") !== "false";

const CLIENT_ID = process.env.FUTU_CLIENT_ID;
const CLIENT_SECRET = process.env.FUTU_CLIENT_SECRET;
// 富途 REST API base（免閘道 OAuth 2.1）。實際 endpoint 待憑證到手後對齊官方文檔。
const FUTU_API_BASE = process.env.FUTU_API_BASE || "https://openapi.futunn.com";

export function hasFutuCreds(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET;
}

// 真實富途調用骨架（憑證到手後啟用）。目前返回 null 觸發 fallback。
async function futuGet<T>(_path: string): Promise<T | null> {
  if (!hasFutuCreds()) return null;
  // TODO: OAuth 2.1 取 token → GET `${FUTU_API_BASE}${_path}`
  return null;
}

function toUsSymbol(symbol: string): string {
  return symbol.toUpperCase().startsWith("US.") ? symbol.toUpperCase() : `US.${symbol.toUpperCase()}`;
}

// 彙整完整報告（真實 Nasdaq 優先，逐項 fallback 並標註來源）
export async function buildReport(rawSymbol: string): Promise<StockReport> {
  const symbol = toUsSymbol(rawSymbol);
  const sources: Record<string, DataSource> = {};

  // ---- 第一波：並行拉取 Nasdaq（行情/日線/摘要/財務/大盤）----
  const [realQuote, realDaily, summary, finRaw, spyTrend] = REAL_DATA
    ? await Promise.all([
        nasdaq.fetchQuote(symbol),
        nasdaq.fetchDaily(symbol),
        nasdaq.fetchSummary(symbol),
        nasdaq.fetchFinancials(symbol),
        nasdaq.fetchSpyTrend(),
      ])
    : [null, null, null, null, null];

  // ---- 逐項組裝（真實優先，mock 兜底）----
  const quote: Quote = realQuote || mock.mockQuote(symbol);
  sources.quote = realQuote ? "nasdaq" : "mock";

  const daily: Candle[] = realDaily || mock.mockDailyCandles(symbol);
  sources.candlesDaily = realDaily ? "nasdaq" : "mock";

  // 財務：Nasdaq 年報四表
  const financials: Financials = finRaw?.fin || mock.mockFinancials(symbol);
  sources.financials = finRaw ? "nasdaq" : "mock";

  // 估值：市值 + 財務推導（PE/PEG/PB/PS/FCF yield/EV-Sales）
  const derivedVal = summary && finRaw ? nasdaq.deriveValuation(summary.marketCap, finRaw) : null;
  const valuation: Valuation = derivedVal || mock.mockValuation(symbol);
  sources.valuation = derivedVal ? "derived" : "mock";

  // 日內：Nasdaq 無分時 → 日線降級（按日收盤畫）
  const intraday =
    (await futuGet<Candle[]>(`/quote-api/candles?symbol=${symbol}&range=1D`)) ||
    daily.slice(-60).map((c) => ({ ...c, open: c.close, high: c.close, low: c.close }));
  sources.candlesIntraday = "mock";

  // 評級/新聞：無穩定免費源 → mock 標註（待接 Finnhub key 或富途）
  const ratings: Ratings = (await futuGet<Ratings>(`/quote-api/ratings?symbol=${symbol}`)) || mock.mockRatings(symbol);
  sources.ratings = "mock";
  const news: NewsItem[] = (await futuGet<NewsItem[]>(`/quote-api/news?symbol=${symbol}`)) || mock.mockNews(symbol);
  sources.news = "mock";

  // ---- 第二波：產業相對強弱（依賴 summary.sector）----
  const sectorStrong = (REAL_DATA && summary ? await nasdaq.fetchSectorStrength(summary.sector) : null) ?? true;
  sources.sectorStrong = sectorStrong === null ? "proxy" : "nasdaq";
  const marketTrendUp = spyTrend ?? true;
  sources.marketTrendUp = spyTrend === null ? "proxy" : "nasdaq";

  // ---- 純計算層（本地推導，不吃外部數據）----
  const indicators = computeIndicators(daily);
  const scoreResult = score({
    financials,
    valuation,
    ratings,
    indicators,
    marketTrendUp,
    sectorStrong,
  });
  const memo = buildMemo(indicators, daily);
  const plan = buildPlan(indicators, daily);
  const rules = buildRules(memo);
  const auditResult = audit(scoreResult, memo, plan);
  const buyPoints = findBuyPoints(daily);
  sources.indicators = "derived";
  sources.scoring = "derived";

  return {
    quote: quote as StockReport["quote"],
    score: scoreResult,
    memo,
    rules,
    plan,
    audit: auditResult,
    buyPoints,
    news: news as StockReport["news"],
    candlesDaily: daily,
    candlesIntraday: intraday,
    sources,
  };
}

export async function searchSymbols(q: string) {
  // 真實搜索：直接查 Nasdaq 該 ticker 的 info，命中即回公司名
  if (REAL_DATA && /^[A-Za-z.]{1,6}$/.test(q.trim())) {
    const ticker = q.trim().toUpperCase().replace(/^US\./, "");
    const info = await nasdaq.fetchQuote(ticker);
    if (info && info.name) {
      return [{ symbol: `US.${ticker}`, name: info.name, type: "STOCK" }];
    }
  }
  return (await futuGet<import("../types").SearchResult[]>(`/quote-api/search?q=${encodeURIComponent(q)}`)) || mock.mockSearch(q);
}
