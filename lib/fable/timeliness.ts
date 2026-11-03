import type { Quote } from "../types";
import { marketSession, nyClock } from "../market/calendar";

import { parseQuoteTime } from "../market/quote-time";

export function newYorkDay(date: Date): string {
  return nyClock(date).day;
}

// 已核對時間轉為美東日期；純日期只比較標籤，不以 fetchedAt 當成交時間。
export function quoteDay(quote: Quote): string | null {
  if (typeof quote.timestamp === "number" && Number.isFinite(quote.timestamp) && quote.timestamp > 0) {
    const date = new Date(quote.timestamp * 1000);
    return Number.isFinite(date.getTime()) ? newYorkDay(date) : null;
  }
  return parseQuoteTime(quote.asOf)?.day ?? null;
}

export function checkQuoteDate(quote: Quote, lastDailyTime: number, asOf: Date) {
  const quoteDate = quoteDay(quote);
  const dailyDate = new Date(lastDailyTime * 1000).toISOString().slice(0, 10);
  const today = newYorkDay(asOf);
  const timestamp = quote.timestamp ?? parseQuoteTime(quote.asOf)?.timestamp;
  const timestampFuture = typeof timestamp === "number" && timestamp > asOf.getTime() / 1000;
  const quoteSession = quoteDate ? marketSession(quoteDate) : null;
  const pass = quoteDate !== null && quoteDate >= dailyDate && quoteDate <= today && !timestampFuture
    && quoteSession?.closeMinute != null;
  return {
    name: "報價／日線日期", pass: pass ? true : null,
    note: quoteDate === null ? `報價日期未能核對；最後已收盤日線 ${dailyDate}。不以讀取時間補作成交時間，暫停當前入場參考價。`
      : timestampFuture ? `來源報價時間 ${quote.asOf ?? quote.timestamp} 在未來，暫停當前入場參考價；不以讀取時間覆蓋來源時間。`
      : !pass ? `報價日期 ${quoteDate}，最後已收盤日線 ${dailyDate}，核對日期 ${today}；日期未對齊、在未來、非參考交易日或超出日曆範圍，原因尚未核實，不自行改日期，暫停當前入場參考價。`
      : `來源報價日期 ${quoteDate}，最後已收盤日線 ${dailyDate}；日期符合要求${timestamp != null ? "；明示 ET 時間已轉換（分鐘精度）" : "；成交時間及時區仍未核實"}，不代表已獨立確認即時性。`,
  };
}
