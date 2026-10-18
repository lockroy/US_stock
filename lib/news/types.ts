import type { DataSource, NewsItem } from "../types";

export interface NewsResult {
  data: NewsItem[];
  source: DataSource;
  status: "ready" | "empty" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable";
  message: string;
  fetchedAt?: number;
}

export type NewsProvider = (symbol: string) => Promise<NewsResult>;
