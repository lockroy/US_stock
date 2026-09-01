// 真實數據源：Nasdaq 公開 API（免 key、免帳號）
// 提供：即時報價 + 歷史日線（OHLCV）。財務/估值/評級/新聞無此源數據，由 caller 用估算兜底並標註。
import type { Candle, Quote } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 符號正規化：去 US. 前綴、大寫，Nasdaq 用純 ticker（AAPL / TSLA）
export function toTicker(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  return s.startsWith("US.") ? s.slice(3) : s;
}

function parseMoney(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.replace(/[$,]/g, "")) || 0;
}

function parseDateUS(s: string): number {
  // "08/28/2026" -> unix seconds (UTC)
  const [m, d, y] = s.split("/").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

// 即時報價
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  const ticker = toTicker(symbol);
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/quote/${ticker}/info?assetclass=stocks`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const d = (await res.json())?.data;
    if (!d) return null;
    const p = d.primaryData || {};
    const last = parseMoney(p.lastSalePrice);
    const change = parseMoney(p.netChange?.replace(/^\+/, ""));
    const changePct = parseFloat(String(p.percentageChange || "").replace(/[%+]/g, "")) || 0;
    const volume = parseMoney(p.volume);
    return {
      symbol: ticker,
      name: d.companyName || ticker,
      lastPrice: last,
      change,
      changePct,
      volume,
      timestamp: Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}

// 歷史日線（OHLCV）。days: 拉取最近多少個交易日（近似，用日曆天回推）
export async function fetchDaily(symbol: string, days = 260): Promise<Candle[] | null> {
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
      .map((r: any) => ({
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

// 日內/分時：Nasdaq 免費接口無穩定分時，回傳 null 讓 caller 用日線降級
export async function fetchIntraday(_symbol: string): Promise<Candle[] | null> {
  return null;
}
