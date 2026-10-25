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
  change: number | null;
  changePct: number | null;
  volume: number | null;
  timestamp: number | null; // 已核對的成交時間；不確定時區時 null
  asOf?: string | null; // 供應商原始時間文字
  fetchedAt?: number; // 本次資料讀取時間，不是成交時間
  isRealTime?: boolean | null;
  marketStatus?: string | null;
  securityType?: string | null; // 供應商原文，不能單憑此欄核實 ADR 比率
  exchange?: string | null;
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
  epsEvidence?: EpsEvidence;
  epsHistory?: EpsVersion[];
}

export interface EpsVersion {
  filed: string;
  accession: string;
  form: string;
  status: "ready" | "incomparable";
  current: number | null;
  previous: number | null;
  growth: number | null;
  usableFromDate: string; // 缺接受時間，保守自申報日翌日開始；不是完整時點財務庫
}

export interface DividendEvidence {
  status: "available" | "none_reported" | "unavailable";
  source: "nasdaq";
  url: string;
  fetchedAt: number;
  events: { exDate: string; amount: number; currency: string | null; paymentDate: string | null; declarationDate: string | null }[];
  rejectedRows: number;
  completeness: "unknown";
  message: string;
}

export interface ComparabilityEvidence {
  dividends: DividendEvidence;
  priceAdjustment: "unverified";
  financialHistory: "latest_snapshot_only";
  security: {
    type: string | null;
    exchange: string | null;
    epsCurrency: "USD" | null;
    statementCurrency: null;
    adrRatio: null;
    shareClassVerified: false;
  };
}

export interface EpsEvidence {
  source: "sec";
  cik: string;
  metric: "EarningsPerShareDiluted";
  unit: "USD/shares";
  current: number;
  previous: number;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  filed: string;
  accession: string;
  form: string;
  url: string;
}

export interface Valuation {
  pe: number | null;
  peg: number | null;
  pb: number | null;
  fcfYield: number | null;
  ps: number | null; // fallback for loss-making
  evSales: number | null; // fallback
  pegBasis?: string;
  pegMessage?: string;
  pegApplicability?: "applicable" | "not_applicable" | "unknown";
  financialPeriodEnd?: string;
  annualNetIncomeUSD?: number | null;
  marketCapSnapshot?: MarketCapSnapshot;
}

export interface MarketCapSnapshot {
  value: number | null;
  currency: "USD";
  source: "nasdaq";
  fetchedAt: number; // 讀取時間，非供應商更新時間
  asOf: null; // 尚未取得明確的市值更新時間
  refreshPolicy: "on-demand-no-store";
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
  note?: string;
  applicability?: "applicable" | "not_applicable" | "unknown";
}

export interface ScoreResult {
  total: number | null; // 已知項目加權得分 / 可用權重 × 100；無資料為 null
  earnedPoints: number; // 原始已知得分，不是 /100 的總評
  tier: string; // 資料範圍標籤，不是買賣指令
  dimensions: DimensionScore[];
  factors: FactorScore[];
  proxies: string[]; // 代理指標說明
  completeness: { percent: number; availablePoints: number; missing: string[]; excludedPoints: number; applicablePoints: number };
}

export interface DimensionScore {
  dimension: string;
  score: number | null;
  earnedPoints: number;
  availablePoints: number;
  max: number;
  coverage: number;
  missing: string[];
  notApplicable: string[];
  applicablePoints: number;
}

export type StrategyStatus = "符合入場條件" | "等待觸發" | "條件不符合" | "資料不足";

export interface StrategyCheck {
  name: string;
  pass: boolean | null;
  note: string;
}

export interface StrategyAssessment {
  technical: {
    status: StrategyStatus;
    checks: StrategyCheck[];
    evaluatedBarTime: number | null;
    referencePlan: TradePlan | null;
    rewardRisk: number | null;
  };
  fundamental: { status: StrategyStatus; checks: StrategyCheck[] };
  caveats: string[];
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

export type DataSource = "nasdaq" | "sec" | "finnhub" | "google_news" | "mock" | "derived" | "proxy" | "unknown";

// 完整報告
export interface StockReport {
  comparability?: ComparabilityEvidence;
  quote: Quote;
  mode: "real" | "demo";
  score: ScoreResult;
  strategy: StrategyAssessment;
  financials?: Financials | null;
  valuation?: Valuation | null;
  marketCap?: MarketCapSnapshot | null;
  timing?: {
    calendar: import("./market/calendar").CalendarSnapshot;
    quoteDate: string | null;
    lastAvailableDailyDate: string | null;
    lastClosedDailyDate: string | null;
  };
  memo: ResearchMemo;
  rules: TradeRule[];
  plan: TradePlan | null;
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
  sources?: Record<string, DataSource>;
  status?: import("./news/types").NewsResult["status"];
  fetchedAt?: number;
  diagnosticId?: string;
  diagnostic?: import("./news/types").NewsDiagnostic;
  message?: string;
}
