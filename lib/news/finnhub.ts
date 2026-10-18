import type { NewsItem } from "../types";
import type { NewsResult } from "./types";
export type { NewsResult } from "./types";
import { normalizeTicker } from "../futu/symbol";

export async function fetchCompanyNews(symbol: string, options: {
  apiKey?: string; fetcher?: typeof fetch; now?: Date;
} = {}): Promise<NewsResult> {
  const fail = (status: NewsResult["status"], message: string): NewsResult => ({ data: [], source: "unknown", status, message });
  const ticker = normalizeTicker(symbol);
  if (!ticker) return fail("unavailable", "新聞股票代號無效");
  const key = options.apiKey ?? process.env.FINNHUB_API_KEY;
  if (!key?.trim()) return fail("not_configured", "Finnhub 新聞尚未配置 API key");
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - 7 * 86400000);
  const url = new URL("https://api.finnhub.io/api/v1/company-news");
  url.search = new URLSearchParams({ symbol: ticker, from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }).toString();
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: { "X-Finnhub-Token": key, Accept: "application/json" },
      signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) return fail("unauthorized", "Finnhub 新聞授權失敗，請檢查 API key 及方案權限");
    if (response.status === 429) return fail("rate_limited", "Finnhub 新聞請求額度已達上限，請稍後再試");
    if (!response.ok) return fail("unavailable", "Finnhub 新聞服務暫時不可用");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return fail("unavailable", "Finnhub 新聞資料格式無效");
    const items: NewsItem[] = [];
    const seen = new Set<string>();
    for (const row of payload) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.headline !== "string" || !r.headline.trim() || typeof r.source !== "string" || !r.source.trim()
        || typeof r.url !== "string" || typeof r.datetime !== "number" || !Number.isFinite(r.datetime)
        || r.datetime < start.getTime() / 1000 || r.datetime > now.getTime() / 1000) continue;
      let link: URL;
      try { link = new URL(r.url); } catch { continue; }
      if (!["https:", "http:"].includes(link.protocol) || link.username || link.password || seen.has(link.href)) continue;
      seen.add(link.href);
      items.push({ title: r.headline.trim(), source: r.source.trim(), url: link.href, time: r.datetime, summary: "" });
    }
    if (payload.length && !items.length) return fail("unavailable", "Finnhub 未提供有效的近期新聞");
    const data = items.sort((a, b) => b.time - a.time).slice(0, 10);
    return { data, source: "finnhub", status: data.length ? "ready" : "empty", message: data.length ? "Finnhub 提供最近七日新聞，點擊標題閱讀原文" : "Finnhub 最近七日沒有相關新聞" };
  } catch {
    // 不回傳供應商錯誤內容或請求資訊，避免洩漏憑證。
    return fail("unavailable", "Finnhub 新聞服務暫時不可用");
  }
}
