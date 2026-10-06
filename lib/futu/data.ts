import type { Candle, Quote, Financials, Valuation, Ratings, NewsItem, SearchResult, DataResponse, Range } from "../types";
import { getDataContext, searchSymbols, ReportError, type ReportOptions } from "./client";
import { validateCandles } from "../indicators/indicators";
import { aggregateCandles } from "./candles";
import * as mock from "./mock";

export type DataKind = "quote" | "candles" | "financials" | "valuation" | "ratings" | "news";
type StockData = Quote | Candle[] | Financials | Valuation | Ratings | NewsItem[];

export async function getStockData(kind: DataKind, symbol: string, rawRange = "day", options: ReportOptions = {}): Promise<DataResponse<StockData>> {
  if (kind === "candles" && !["day", "week", "month", "1D"].includes(rawRange)) {
    throw new ReportError("INVALID_RANGE", "range 必須為 day、week、month 或 1D");
  }
  const context = await getDataContext(symbol, options);
  const { mode, provider } = context;
  const real = mode === "real";
  const response: DataResponse<StockData> = { symbol: context.symbol, mode, source: "unknown", data: null };
  if (kind === "quote") return { ...response, source: real ? "nasdaq" : "mock", data: context.quote };
  if (kind === "ratings") return { ...response, source: real ? "unknown" : "mock", data: real ? null : mock.mockRatings(context.symbol) };
  if (kind === "news") return { ...response, source: real ? "unknown" : "mock", data: real ? [] : mock.mockNews(context.symbol) };
  if (kind === "financials") {
    const data = real ? (await provider.fetchFinancials(context.symbol))?.fin ?? null : mock.mockFinancials(context.symbol);
    return { ...response, source: data ? real ? "nasdaq" : "mock" : "unknown", data };
  }
  if (kind === "valuation") {
    if (!real) return { ...response, source: "mock", data: mock.mockValuation(context.symbol) };
    const [summary, raw] = await Promise.all([provider.fetchSummary(context.symbol), provider.fetchFinancials(context.symbol)]);
    const data = summary && raw ? provider.deriveValuation(summary.marketCap, raw) : null;
    return { ...response, source: data ? "derived" : "unknown", data };
  }
  const range = rawRange as Range;
  if (range === "1D") return { ...response, range, source: real ? "unknown" : "mock", data: real ? [] : mock.mockIntradayCandles(context.symbol), message: real ? "尚未接入真實分時資料" : "示範分時資料" };
  const daily = real ? await provider.fetchDaily(context.symbol) : mock.mockDailyCandles(context.symbol);
  if (!daily?.length) throw new ReportError("DATA_UNAVAILABLE", "暫時無法取得日線資料");
  try { validateCandles(daily); } catch { throw new ReportError("DATA_UNAVAILABLE", "日線資料格式無效"); }
  const inputSource = real ? "nasdaq" : "mock";
  if (range === "day") return { ...response, range, source: inputSource, data: daily };
  return { ...response, range, source: "derived", inputSource, data: aggregateCandles(daily, range), message: "首末週／月可能僅涵蓋部分期間" };
}

export async function getSearchData(query: string, options: ReportOptions = {}): Promise<DataResponse<SearchResult[]>> {
  const mode = (options.realData ?? process.env.REAL_DATA !== "false") ? "real" : "demo";
  const data = await searchSymbols(query, options);
  return { query: query.trim(), mode, source: mode === "real" ? "nasdaq" : "mock", data };
}
