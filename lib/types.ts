// 共享型別：前後端共用

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Range = "day" | "week" | "month" | "1D";

export interface Quote {
  symbol: string;
  name: string;
  lastPrice: number;
  change: number;
  changePct: number;
  volume: number;
  timestamp: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  exchange?: string;
}

export interface Financials {
  revenueGrowth: number | null; // YoY %
  epsGrowth: number | null; // 真正 EPS YoY %，不得以淨利增長代替
  netIncomeGrowth?: number | null; // 淨利 YoY %，獨立顯示，不用作 EPS 或 PEG
  grossMargin: number | null; // %
  roe: number | null; // %
  roic: number | null; // %
  debtToEquity: number | null;
  fcf: number | null; // Nasdaq: 千美元
  periodEnd?: string;
  notes?: Record<string, string>;
}

export interface Valuation {
  pe: number | null;
  peg: number | null;
  pb: number | null;
  fcfYield: number | null;
  ps: number | null; // fallback for loss-making
  evSales: number | null; // fallback
}

export interface Ratings {
  ratingScore: number; // 0-5
  buy: number;
  hold: number;
  sell: number;
}

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  time: number;
  summary: string;
}

// 指標快照
export interface IndicatorSnapshot {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  k: number;
  d: number;
  bollUpper: number;
  bollMid: number;
  bollLower: number;
  atr: number;
  volumeWeightedPrice20: number | null; // 20 根日線 typical-price 成交量加權均價
  lastClose: number;
}

// 評分
export interface FactorScore {
  dimension: string;
  sub: string;
  score: number;
  max: number;
  available?: boolean;
  availableMax?: number;
  missingInputs?: string[];
}

export interface ScoreResult {
  total: number; // 0-100
  tier: string; // 評級
  factors: FactorScore[];
  proxies: string[]; // 代理指標說明
  completeness: { percent: number; availablePoints: number; missing: string[] };
}

// Fable 增強
export interface ResearchMemo {
  trend: string;
  keyLevels: string; // 支撐/壓力
  momentum: string;
  volatility: string;
  invalidation: string; // 失效條件（必填）
}

export interface TradeRule {
  entry: string;
  exit: string;
  stop: string;
  size: string; // 部位%
  timeframe: string;
}

export interface TradePlan {
  buyZone: string;
  entry: number;
  target: number;
  stop: number;
}

export type AuditVerdict = "核准" | "修改" | "拒絕" | "未驗證";

export interface AuditItem {
  name: string;
  pass: boolean | null;
  note: string;
}

export interface AuditResult {
  items: AuditItem[];
  verdict: AuditVerdict;
}

export interface BuyPoint {
  time: number;
  price: number;
  reason: string;
}

export type DataSource = "nasdaq" | "finnhub" | "google_news" | "mock" | "derived" | "proxy" | "unknown";

// 完整報告
export interface StockReport {
  quote: Quote;
  mode: "real" | "demo";
  score: ScoreResult;
  financials?: Financials | null;
  memo: ResearchMemo;
  rules: TradeRule[];
  plan: TradePlan;
  audit: AuditResult;
  buyPoints: BuyPoint[];
  news: NewsItem[];
  newsStatus?: import("./news/types").NewsResult["status"];
  newsMessage?: string;
  newsFetchedAt?: number;
  candlesDaily: Candle[];
  candlesIntraday: Candle[];
  sources: Record<string, DataSource>; // 各數據塊實際來源（nasdaq=真實/mock=模擬/derived=推導/proxy=代理）
}


export interface DataResponse<T> {
  mode: "real" | "demo";
  source: DataSource;
  data: T | null;
  symbol?: string;
  query?: string;
  range?: Range;
  inputSource?: DataSource;
  status?: import("./news/types").NewsResult["status"];
  fetchedAt?: number;
  diagnosticId?: string;
  diagnostic?: import("./news/types").NewsDiagnostic;
  message?: string;
}
