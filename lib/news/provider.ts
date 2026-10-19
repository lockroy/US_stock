import { fetchGoogleNews } from "./google";
import type { NewsProvider, NewsResult } from "./types";

export function getNews(symbol: string, provider: NewsProvider = fetchGoogleNews): Promise<NewsResult> {
  if (process.env.NEWS_ENABLED === "false") return Promise.resolve({ data: [], source: "unknown", status: "disabled", message: "新聞功能暫停，未請求外部新聞來源。" });
  return provider(symbol);
}
