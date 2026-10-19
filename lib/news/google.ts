import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeTicker } from "../futu/symbol";
import type { NewsItem } from "../types";
import type { NewsDiagnostic, NewsResult } from "./types";
import { inspectGoogleFailure } from "./diagnostics";

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
  const ticker = normalizeTicker(symbol);
  let phase = "validation";
  let upstreamStatus: number | undefined;
  let contentType: string | undefined;
  const fail = (status: NewsResult["status"], message: string, details?: Omit<NewsDiagnostic, "phase">): NewsResult => {
    const diagnosticId = details ? crypto.randomUUID() : undefined;
    const diagnostic = details ? { phase, ...details } : undefined;
    if (diagnostic) console.warn("news-google-failure", JSON.stringify({ diagnosticId, provider: "google_news", symbol: ticker, ...diagnostic }));
    return { data: [], source: "unknown", status, message, ...(diagnosticId ? { diagnosticId, diagnostic } : {}) };
  };
  if (!ticker) return fail("unavailable", "新聞股票代號無效");
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({ q: `${ticker} stock when:7d`, hl: "en-US", gl: "US", ceid: "US:en" }).toString();
  try {
    phase = "fetch";
    const signal = AbortSignal.timeout(8000);
    const request = (target: URL) => (options.fetcher ?? fetch)(target, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      // Workers 只支援 follow/manual；逐次核對目標，避免進入驗證頁或其他網站。
      signal, redirect: "manual", next: { revalidate: 300 },
    });
    let current = url;
    let response = await request(current);
    upstreamStatus = response.status;
    contentType = response.headers.get("content-type")?.slice(0, 80);
    for (let hops = 0; [301, 302, 303, 307, 308].includes(response.status); hops++) {
      const location = response.headers.get("location");
      let target: URL;
      try { target = new URL(location ?? "", current); }
      catch { return fail("unavailable", `Google 新聞重新導向無效（HTTP ${response.status}）`, { upstreamStatus: response.status, hint: "invalid_redirect" }); }
      if (!location || hops >= 2 || target.origin !== url.origin || target.pathname !== url.pathname
        || target.username || target.password) {
        await response.body?.cancel();
        return fail("unavailable", `Google 新聞要求額外重新導向，暫時無法讀取（HTTP ${response.status}）`, { upstreamStatus: response.status, hint: "redirect_rejected", redirectHost: location ? target.hostname : null });
      }
      await response.body?.cancel();
      current = target;
      response = await request(current);
      upstreamStatus = response.status;
      contentType = response.headers.get("content-type")?.slice(0, 80);
    }
    phase = "http_response";
    if (response.status === 429) return fail("rate_limited", "Google 新聞暫時限制請求，請稍後再試", await inspectGoogleFailure(response));
    if (!response.ok) return fail("unavailable", `Google 新聞暫時無法讀取（HTTP ${response.status}），請稍後再試`, await inspectGoogleFailure(response));
    phase = "read_body";
    const reader = response.body?.getReader();
    if (!reader) return fail("unavailable", "Google 新聞回應格式無效", { hint: "missing_body" });
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
    phase = "parse_rss";
    const data = parseGoogleNews(Buffer.concat(chunks).toString("utf8"), now);
    return {
      data, source: "google_news", status: data.length ? "ready" : "empty", fetchedAt: Math.floor(now.getTime() / 1000),
      message: data.length ? "Google News 最近七日搜尋結果；可能包含不相關新聞，連結經 Google 跳轉至原文。"
        : "Google News 最近七日沒有可顯示的相關新聞。",
    };
  } catch (error) {
    return fail("unavailable", "Google 新聞讀取失敗或格式無效，請稍後再試", { upstreamStatus, contentType, errorName: error instanceof Error ? error.name.slice(0, 40) : "UnknownError" });
  }
}
