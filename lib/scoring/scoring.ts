import type {
  Financials,
  Valuation,
  Ratings,
  IndicatorSnapshot,
  ScoreResult,
  FactorScore,
} from "../types";

// 工具：把 0-1 比率映射到 0-max 分（超過 1 也允許，封頂）
function scale(ratio: number, max: number): number {
  return Math.max(0, Math.min(max, ratio * max));
}

// ---- 基本面 30 ----
export function scoreFundamental(f: Financials): { score: number; factors: FactorScore[] } {
  const growth = scale((Math.max(0, f.revenueGrowth) + Math.max(0, f.epsGrowth)) / 30, 10); // 各 15% 成長 → 滿分
  const profit = scale((Math.max(0, f.grossMargin) + Math.max(0, f.roe) + Math.max(0, f.roic)) / 150, 10);
  const structure = scale((f.fcf > 0 ? 5 : 0) + (f.debtToEquity < 1 ? 5 : 0), 10);
  const score = growth + profit + structure;
  return {
    score,
    factors: [
      { dimension: "基本面", sub: "營收/EPS 成長", score: +growth.toFixed(1), max: 10 },
      { dimension: "基本面", sub: "獲利能力(毛利/ROE/ROIC)", score: +profit.toFixed(1), max: 10 },
      { dimension: "基本面", sub: "資產負債與 FCF", score: +structure.toFixed(1), max: 10 },
    ],
  };
}

// ---- 估值 20（校準版 2026-08-29）----
// 修正背景：原 P/B 門檻 >10 即歸零，對美股科技/成長股過嚴
//（AAPL 實際 P/B 約 50、NVDA 約 40、MSFT 約 12），會系統性低估該類標的。
// 校準原則：
//   1. P/E、PEG、P/B 改分段給分，高值保底不歸零（貴 ≠ 零分，只是低分）
//   2. 高 ROE(>20%) 公司的 P/B 額外 +1（高 P/B 有盈利質量支撐）
//   3. 深度價值區（低 P/E、低 P/B）仍給高分，保持估值鑑別力

function peBand(pe: number): number {
  // 8 分制：<15 滿分；15-25 → 8..5；25-35 → 5..3；35-50 → 3..1；>50 保底 1
  if (pe <= 15) return 8;
  if (pe <= 25) return 8 - ((pe - 15) * 3) / 10;
  if (pe <= 35) return 5 - ((pe - 25) * 2) / 10;
  if (pe <= 50) return 3 - ((pe - 35) * 2) / 15;
  return 1;
}

function pegBand(peg: number): number {
  // 6 分制：<1 滿分；1-1.5 → 6..4；1.5-2 → 4..2；>2 保底 1
  if (peg <= 1) return 6;
  if (peg <= 1.5) return 6 - (peg - 1) * 4;
  if (peg <= 2) return 4 - (peg - 1.5) * 4;
  return 1;
}

function pbBand(pb: number, roe?: number): number {
  // 6 分制分段：≤1.5 滿分（深度價值/金融）；1.5-4（消費/工業）；4-10（一般）；
  // 10-20（科技常見）；20-40（高成長）；>40 保底 1 分不歸零；高 ROE(>20%) +1（上限 6）
  let s: number;
  if (pb <= 1.5) s = 6;
  else if (pb <= 4) s = 6 - ((pb - 1.5) * 2) / 2.5;
  else if (pb <= 10) s = 4 - (pb - 4) / 6;
  else if (pb <= 20) s = 3 - (pb - 10) / 10;
  else if (pb <= 40) s = 2 - (pb - 20) / 20;
  else s = 1;
  if (roe != null && roe > 20) s = Math.min(6, s + 1);
  return s;
}

export function scoreValuation(v: Valuation, roe?: number): { score: number; factors: FactorScore[] } {
  // 虧損股退路：改用 P/S
  if (v.pe == null) {
    const psScore = v.ps != null ? scale(Math.max(0, 3 - v.ps) / 3, 8) : 0;
    const evScore = v.evSales != null ? scale(Math.max(0, 5 - v.evSales) / 5, 6) : 0;
    const fcfScore = v.fcfYield != null ? scale(Math.max(0, v.fcfYield) / 8, 6) : 0;
    const score = psScore + evScore + fcfScore;
    return {
      score,
      factors: [
        { dimension: "估值", sub: "P/S (虧損股退路)", score: +psScore.toFixed(1), max: 8 },
        { dimension: "估值", sub: "EV/Sales (退路)", score: +evScore.toFixed(1), max: 6 },
        { dimension: "估值", sub: "現金流收益率", score: +fcfScore.toFixed(1), max: 6 },
      ],
    };
  }
  const peScore = peBand(v.pe);
  const pegScore = v.peg != null ? pegBand(v.peg) : 0;
  const pbScore = v.pb != null ? pbBand(v.pb, roe) : 0;
  const score = peScore + pegScore + pbScore;
  return {
    score,
    factors: [
      { dimension: "估值", sub: "P/E 配 PEG", score: +(peScore + pegScore).toFixed(1), max: 14 },
      { dimension: "估值", sub: "P/B", score: +pbScore.toFixed(1), max: 6 },
    ],
  };
}

// ---- 技術 30 ----
export function scoreTechnical(ind: IndicatorSnapshot): { score: number; factors: FactorScore[]; resonance: boolean } {
  // 均線排列
  let ma = 0;
  if (ind.ema20 > ind.ema50) ma += 5;
  if (ind.ema50 > ind.ema200) ma += 5;
  // 動能
  let mom = 0;
  if (ind.rsi >= 40 && ind.rsi <= 70) mom += 4;
  else if (ind.rsi > 70) mom += 2; // 過熱但強
  else mom += 1;
  if (ind.macd > ind.macdSignal) mom += 3;
  if (ind.k > ind.d) mom += 3;
  // 量價/VWAP
  const vp = ind.lastClose > ind.vwap ? 5 : 0;
  // 共振
  const resonance = ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200 && ind.rsi < 70 && ind.macd > ind.macdSignal;
  const resonanceScore = resonance ? 5 : 2;
  const score = ma + mom + vp + resonanceScore;
  return {
    score,
    resonance,
    factors: [
      { dimension: "技術", sub: "均線排列(20/50/200)", score: +ma.toFixed(1), max: 10 },
      { dimension: "技術", sub: "動能(RSI/MACD/KD)", score: +mom.toFixed(1), max: 10 },
      { dimension: "技術", sub: "量價/VWAP", score: +vp.toFixed(1), max: 5 },
      { dimension: "技術", sub: "布林+ATR 共振", score: +resonanceScore.toFixed(1), max: 5 },
    ],
  };
}

// ---- 情緒/宏觀 20 (代理指標) ----
export function scoreSentiment(r: Ratings, marketTrendUp: boolean, sectorStrong: boolean): { score: number; factors: FactorScore[]; proxies: string[] } {
  const moat = scale(r.ratingScore / 5, 8); // 代理：分析師評級
  const macro = (marketTrendUp ? 4 : 1) + (sectorStrong ? 3 : 1); // 代理：大盤+產業
  const rating = scale(r.ratingScore / 5, 5);
  const score = moat + macro + rating;
  return {
    score,
    proxies: ["護城河=分析師評級代理", "總經=SPY 趨勢+產業相對強弱代理"],
    factors: [
      { dimension: "情緒/宏觀", sub: "產業護城河(代理)", score: +moat.toFixed(1), max: 8 },
      { dimension: "情緒/宏觀", sub: "總經環境(代理)", score: +macro.toFixed(1), max: 7 },
      { dimension: "情緒/宏觀", sub: "財報/評級", score: +rating.toFixed(1), max: 5 },
    ],
  };
}

// ---- 彙總 + 分級 ----
export function tierOf(total: number): string {
  if (total >= 80) return "強烈建議買入";
  if (total >= 65) return "建議買入 / 逢低布局";
  if (total >= 50) return "觀望 / 持有";
  return "避開 / 賣出";
}

export interface ScoreInput {
  financials: Financials;
  valuation: Valuation;
  ratings: Ratings;
  indicators: IndicatorSnapshot;
  marketTrendUp: boolean;
  sectorStrong: boolean;
}

export function score(input: ScoreInput): ScoreResult {
  const f = scoreFundamental(input.financials);
  const v = scoreValuation(input.valuation, input.financials.roe);
  const t = scoreTechnical(input.indicators);
  const s = scoreSentiment(input.ratings, input.marketTrendUp, input.sectorStrong);
  const factors = [...f.factors, ...v.factors, ...t.factors, ...s.factors];
  const total = Math.round(f.score + v.score + t.score + s.score);
  return {
    total: Math.max(0, Math.min(100, total)),
    tier: tierOf(total),
    factors,
    proxies: s.proxies,
  };
}
