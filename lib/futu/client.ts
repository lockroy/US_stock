import type { StockReport, Candle, Financials, Valuation, Ratings, NewsItem } from "../types";
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

// 真實富途調用骨架（憑證到手後啟用）。目前返回 null 觸發 mock 兜底。
async function futuGet<T>(_path: string): Promise<T | null> {
  if (!hasFutuCreds()) return null;
  // TODO: OAuth 2.1 取 token → GET `${FUTU_API_BASE}${_path}`
  // const token = await getToken();
  // const res = await fetch(`${FUTU_API_BASE}${_path}`, { headers: { Authorization: `Bearer ${token}` } });
  // if (!res.ok) return null;
  // return res.json() as Promise<T>;
  return null;
}

function toUsSymbol(symbol: string): string {
  return symbol.toUpperCase().startsWith("US.") ? symbol.toUpperCase() : `US.${symbol.toUpperCase()}`;
}

// 彙整完整報告（mock 或真實）
export async function buildReport(rawSymbol: string): Promise<StockReport> {
  const symbol = toUsSymbol(rawSymbol);

  // 1) 日線：真實 Nasdaq 歷史數據優先，失敗才 mock
  const realDaily = REAL_DATA ? await nasdaq.fetchDaily(symbol) : null;
  const daily = realDaily || (await futuGet<Candle[]>(`/quote-api/candles?symbol=${symbol}&range=day`)) || mock.mockDailyCandles(symbol);

  // 2) 報價：真實 Nasdaq 優先
  const realQuote = REAL_DATA ? await nasdaq.fetchQuote(symbol) : null;
  const quote = realQuote || (await futuGet<import("../types").Quote>(`/quote-api/quote?symbol=${symbol}`)) || mock.mockQuote(symbol);

  // 3) 日內：無穩定免費源，用日線降級成「日內圖」（按日收盤畫）
  const intraday =
    (await futuGet<Candle[]>(`/quote-api/candles?symbol=${symbol}&range=1D`)) ||
    daily.slice(-60).map((c) => ({ ...c, open: c.close, high: c.close, low: c.close }));

  // 4) 財務/估值/評級/新聞：Nasdaq 免費接口無此數據，用估算兜底並標註來源
  const financials = (await futuGet<Financials>(`/quote-api/financials?symbol=${symbol}`)) || mock.mockFinancials(symbol);
  const valuation = (await futuGet<Valuation>(`/quote-api/valuation?symbol=${symbol}`)) || mock.mockValuation(symbol);
  const ratings = (await futuGet<Ratings>(`/quote-api/ratings?symbol=${symbol}`)) || mock.mockRatings(symbol);
  const news = (await futuGet<NewsItem[]>(`/quote-api/news?symbol=${symbol}`)) || mock.mockNews(symbol);

  const indicators = computeIndicators(daily);
  const scoreResult = score({
    financials,
    valuation,
    ratings,
    indicators,
    marketTrendUp: true, // 代理：SPY 均線多空（MVP 預設多頭，待接大盤數據）
    sectorStrong: true, // 代理：產業相對強弱（MVP 預設強，待接產業 ETF）
  });
  const memo = buildMemo(indicators, daily);
  const plan = buildPlan(indicators, daily);
  const rules = buildRules(memo);
  const auditResult = audit(scoreResult, memo, plan);
  const buyPoints = findBuyPoints(daily);

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
