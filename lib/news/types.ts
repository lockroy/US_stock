import type { DataSource, NewsItem } from "../types";

export interface NewsDiagnostic {
  phase: string;
  upstreamStatus?: number;
  contentType?: string;
  hint?: string;
  errorName?: string;
  redirectHost?: string | null;
  retryAfterSeconds?: number;
}

export interface NewsResult {
  data: NewsItem[];
  source: DataSource;
  status: "ready" | "empty" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "disabled";
  message: string;
  fetchedAt?: number;
  diagnosticId?: string;
  diagnostic?: NewsDiagnostic;
}

export type NewsProvider = (symbol: string) => Promise<NewsResult>;
