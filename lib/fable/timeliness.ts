import type { Quote } from "../types";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const validDay = (label: string): string | null => {
  const time = Date.parse(`${label}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === label ? label : null;
};

export function newYorkDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// 只比較來源日期標籤，不猜測原文的時區，也不以 fetchedAt 當成交時間。
export function quoteDay(quote: Quote): string | null {
  if (typeof quote.timestamp === "number" && Number.isFinite(quote.timestamp) && quote.timestamp > 0) {
    const date = new Date(quote.timestamp * 1000);
    return Number.isFinite(date.getTime()) ? newYorkDay(date) : null;
  }
  const text = quote.asOf?.trim() ?? "";
  const iso = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(text);
  if (iso) return validDay(iso[1]);
  const us = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})(?:$|\s)/.exec(text);
  if (!us) return null;
  return validDay(`${us[3]}-${String(months.indexOf(us[1]) + 1).padStart(2, "0")}-${us[2].padStart(2, "0")}`);
}

export function checkQuoteDate(quote: Quote, lastDailyTime: number, asOf: Date) {
  const quoteDate = quoteDay(quote);
  const dailyDate = new Date(lastDailyTime * 1000).toISOString().slice(0, 10);
  const today = newYorkDay(asOf);
  const timestampFuture = typeof quote.timestamp === "number" && quote.timestamp > asOf.getTime() / 1000;
  const pass = quoteDate !== null && quoteDate >= dailyDate && quoteDate <= today && !timestampFuture;
  return {
    name: "報價／日線日期", pass: pass ? true : null,
    note: quoteDate === null ? `報價日期未能核對；最後已收盤日線 ${dailyDate}。不以讀取時間補作成交時間，暫停當前入場參考價。`
      : !pass ? `報價日期 ${quoteDate}，最後已收盤日線 ${dailyDate}，核對日期 ${today}；日期未對齊或在未來，原因尚未核實，不自行改日期，暫停當前入場參考價。`
      : `來源報價日期 ${quoteDate}，最後已收盤日線 ${dailyDate}；日期標籤符合要求，但不代表已核實即時性或成交時區。`,
  };
}
