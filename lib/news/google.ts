import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeTicker } from "../futu/symbol";
import type { NewsItem } from "../types";
import type { NewsResult } from "./types";

const MAX_BYTES = 2_000_000;
const WEEK = 7 * 86400;

// RSS 的新聞網址保留 Google 跳轉；不解碼或抓取出版商全文。
export function parseGoogleNews(xml: string, now = new Date()): NewsItem[] {
  if (Buffer.byteLength(xml, "utf8") > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)
    || XMLValidator.validate(xml) !== true) throw new Error("Invalid RSS");
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel || typeof channel !== "object") throw new Error("Missing RSS channel");
  const rows = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  let valid = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const title = row.title;
    const source = typeof row.source === "string" ? row.source : row.source?.["#text"];
    const time = typeof row.pubDate === "string" ? Date.parse(row.pubDate) / 1000 : NaN;
    if (typeof title !== "string" || !title.trim() || typeof source !== "string" || !source.trim()
      || typeof row.link !== "string" || !Number.isFinite(time)) continue;
    let url: URL;
    try { url = new URL(row.link); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname !== "news.google.com" || url.port || url.username || url.password
      || !/^\/(?:rss\/)?articles\//.test(url.pathname)) continue;
    valid++;
    if (time < now.getTime() / 1000 - WEEK || time > now.getTime() / 1000 || seen.has(url.href)) continue;
    seen.add(url.href);
    items.push({ title: title.trim(), source: source.trim(), url: url.href, time, summary: "" });
  }
  if (rows.length && !valid) throw new Error("No valid RSS items");
  return items.sort((a, b) => b.time - a.time).slice(0, 10);
}

export async function fetchGoogleNews(symbol: string, options: { fetcher?: typeof fetch; now?: Date } = {}): Promise<NewsResult> {
  const fail = (status: NewsResult["status"], message: string): NewsResult => ({ data: [], source: "unknown", status, message });
  const ticker = normalizeTicker(symbol);
  if (!ticker) return fail("unavailable", "新聞股票代號無效");
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({ q: `${ticker} stock when:7d`, hl: "en-US", gl: "US", ceid: "US:en" }).toString();
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      // workerd 不支援 redirect:"error"；manual 不跟隨重新導向，3xx 由下方 !ok 拒絕。
      signal: AbortSignal.timeout(8000), redirect: "manual", next: { revalidate: 300 },
    });
    if (response.status === 429) return fail("rate_limited", "Google 新聞暫時限制請求，請稍後再試");
    if (!response.ok) return fail("unavailable", "Google 新聞暫時無法讀取，請稍後再試");
    const reader = response.body?.getReader();
    if (!reader) return fail("unavailable", "Google 新聞回應格式無效");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error("RSS too large"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const now = options.now ?? new Date();
    const data = parseGoogleNews(Buffer.concat(chunks).toString("utf8"), now);
    return {
      data, source: "google_news", status: data.length ? "ready" : "empty", fetchedAt: Math.floor(now.getTime() / 1000),
      message: data.length ? "Google News 最近七日搜尋結果；可能包含不相關新聞，連結經 Google 跳轉至原文。"
        : "Google News 最近七日沒有可顯示的相關新聞。",
    };
  } catch { return fail("unavailable", "Google 新聞讀取失敗或格式無效，請稍後再試"); }
}
