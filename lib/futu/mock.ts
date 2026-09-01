import type {
  Candle,
  Quote,
  SearchResult,
  Financials,
  Valuation,
  Ratings,
  NewsItem,
} from "../types";

// 簡單可重現隨機（依 symbol 種子）
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  TSLA: "Tesla Inc.",
  NVDA: "NVIDIA Corp.",
  MSFT: "Microsoft Corp.",
  AMZN: "Amazon.com Inc.",
  GOOGL: "Alphabet Inc.",
  META: "Meta Platforms",
};

export function mockName(symbol: string): string {
  const base = symbol.replace(/^US\./, "").toUpperCase();
  return NAMES[base] || `${base} (Mock)`;
}

// 日 K（250 根）— 帶趨勢與波動
export function mockDailyCandles(symbol: string): Candle[] {
  const rnd = seeded(symbol + "daily");
  const candles: Candle[] = [];
  let price = 80 + rnd() * 120;
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  for (let i = 249; i >= 0; i--) {
    const drift = Math.sin(i / 20) * 0.8 + (rnd() - 0.48) * 2;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rnd() * 1.5;
    const low = Math.min(open, close) - rnd() * 1.5;
    candles.push({
      time: now - i * day,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.floor(20_000_000 + rnd() * 40_000_000),
    });
    price = close;
  }
  return candles;
}

// 分時（78 根，約一天）
export function mockIntradayCandles(symbol: string): Candle[] {
  const rnd = seeded(symbol + "intra");
  const daily = mockDailyCandles(symbol);
  const last = daily[daily.length - 1].close;
  const candles: Candle[] = [];
  let price = last * 0.99;
  const now = Math.floor(Date.now() / 1000);
  const m = 300; // 5 分鐘
  for (let i = 78; i >= 0; i--) {
    const drift = (rnd() - 0.5) * 0.6;
    const open = price;
    const close = Math.max(1, open + drift);
    candles.push({
      time: now - i * m,
      open: +open.toFixed(2),
      high: +Math.max(open, close).toFixed(2),
      low: +Math.min(open, close).toFixed(2),
      close: +close.toFixed(2),
      volume: Math.floor(200_000 + rnd() * 600_000),
    });
    price = close;
  }
  return candles;
}

export function mockQuote(symbol: string): Quote {
  const daily = mockDailyCandles(symbol);
  const last = daily[daily.length - 1];
  const prev = daily[daily.length - 2];
  const change = +(last.close - prev.close).toFixed(2);
  return {
    symbol,
    name: mockName(symbol),
    lastPrice: last.close,
    change,
    changePct: +((change / prev.close) * 100).toFixed(2),
    volume: last.volume,
    timestamp: last.time,
  };
}

export function mockFinancials(symbol: string): Financials {
  const rnd = seeded(symbol + "fin");
  return {
    revenueGrowth: +(8 + rnd() * 25).toFixed(1),
    epsGrowth: +(5 + rnd() * 30).toFixed(1),
    grossMargin: +(35 + rnd() * 45).toFixed(1),
    roe: +(10 + rnd() * 35).toFixed(1),
    roic: +(8 + rnd() * 30).toFixed(1),
    debtToEquity: +(rnd() * 1.5).toFixed(2),
    fcf: +(rnd() * 10).toFixed(2),
  };
}

export function mockValuation(symbol: string): Valuation {
  const rnd = seeded(symbol + "val");
  const pe = +(15 + rnd() * 45).toFixed(1);
  return {
    pe,
    peg: +(1 + rnd() * 2).toFixed(2),
    pb: +(2 + rnd() * 12).toFixed(1),
    fcfYield: +(2 + rnd() * 6).toFixed(1),
    ps: +(2 + rnd() * 15).toFixed(1),
    evSales: +(3 + rnd() * 12).toFixed(1),
  };
}

export function mockRatings(symbol: string): Ratings {
  const rnd = seeded(symbol + "rat");
  const score = +(3.2 + rnd() * 1.8).toFixed(1);
  return {
    ratingScore: score,
    buy: Math.floor(10 + rnd() * 20),
    hold: Math.floor(3 + rnd() * 10),
    sell: Math.floor(rnd() * 5),
  };
}

export function mockSearch(q: string): SearchResult[] {
  const syms = Object.keys(NAMES);
  const matched = syms.filter((s) => s.includes(q.toUpperCase()) || NAMES[s].toLowerCase().includes(q.toLowerCase()));
  const list = matched.length ? matched : [q.toUpperCase()];
  return list.slice(0, 8).map((s) => ({ symbol: `US.${s}`, name: NAMES[s] || s, type: "STOCK" }));
}

export function mockNews(symbol: string): NewsItem[] {
  const base = symbol.replace(/^US\./, "").toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  return [
    { title: `${base} 財報優於預期，營收年增雙位數`, source: "富途資訊", url: "#", time: now - 3600, summary: "最新一季財報顯示需求強勁，管理層上調指引。" },
    { title: `分析師上調 ${base} 目標價`, source: "MarketAux", url: "#", time: now - 7200, summary: "多家投行基於估值修復給出買入評級。" },
    { title: `${base} 宣布回購計畫`, source: "富途資訊", url: "#", time: now - 14400, summary: "董事會授權新一輪股票回購，釋放現金流信號。" },
  ];
}
