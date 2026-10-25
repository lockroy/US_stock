import type {
  Financials,
  Valuation,
  Ratings,
  IndicatorSnapshot,
  ScoreResult,
  FactorScore,
  DimensionScore,
} from "../types";

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// 工具：把 0-1 比率映射到 0-max 分（超過 1 也允許，封頂）
function scale(ratio: number, max: number): number {
  return Math.max(0, Math.min(max, ratio * max));
}

// ---- 基本面 30 ----
export function scoreFundamental(f: Financials): { score: number; factors: FactorScore[] } {
  const factor = (sub: string, values: [string, number | null, number][], rawScore: number): FactorScore => {
    const availableMax = values.reduce((sum, [, value, weight]) => sum + (valid(value) ? weight : 0), 0);
    const missingInputs = values.filter(([, value]) => !valid(value)).map(([name]) => name);
    return { dimension: "基本面", sub, score: Math.min(availableMax, rawScore), max: 10,
      available: missingInputs.length === 0, availableMax, missingInputs };
  };
  const positive = (n: number | null) => valid(n) ? Math.max(0, n) : 0;
  const factors = [
    factor("營收/EPS 成長", [["營收增長", f.revenueGrowth, 5], ["EPS 增長", f.epsGrowth, 5]],
      scale(positive(f.revenueGrowth) / 15, 5) + scale(positive(f.epsGrowth) / 15, 5)),
    factor("獲利能力(毛利/ROE/ROIC)", [["毛利率", f.grossMargin, 10 / 3], ["ROE", f.roe, 10 / 3], ["ROIC", f.roic, 10 / 3]],
      scale(positive(f.grossMargin) / 50, 10 / 3) + scale(positive(f.roe) / 50, 10 / 3) + scale(positive(f.roic) / 50, 10 / 3)),
    factor("資產負債與 FCF", [["自由現金流", f.fcf, 5], ["負債權益比", f.debtToEquity, 5]],
      (valid(f.fcf) && f.fcf > 0 ? 5 : 0) + (valid(f.debtToEquity) && f.debtToEquity >= 0 && f.debtToEquity < 1 ? 5 : 0)),
  ];
  return { score: factors.reduce((sum, item) => sum + item.score, 0), factors };
}

// ---- 估值 20（校準版 2026-08-29）----
// 修正背景：原 P/B 門檻 >10 即歸零，對美股科技/成長股過嚴
//（AAPL 實際 P/B 約 50、NVDA 約 40、MSFT 約 12），會系統性低估該類標的。
// 校準原則：
//   1. P/E、PEG、P/B 改分段給分，高值保底不歸零（貴 ≠ 零分，只是低分）
//   2. ROE 只於基本面計分，不再重複修正 P/B，避免缺 ROE 牽連估值分數
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

function pbBand(pb: number): number {
  // 6 分制分段：≤1.5 滿分（深度價值/金融）；1.5-4（消費/工業）；4-10（一般）；
  // 10-20（科技常見）；20-40（高成長）；>40 保底 1 分不歸零
  let s: number;
  if (pb <= 1.5) s = 6;
  else if (pb <= 4) s = 6 - ((pb - 1.5) * 2) / 2.5;
  else if (pb <= 10) s = 4 - (pb - 4) / 6;
  else if (pb <= 20) s = 3 - (pb - 10) / 10;
  else if (pb <= 40) s = 2 - (pb - 20) / 20;
  else s = 1;
  return s;
}

export function scoreValuation(v: Valuation): { score: number; factors: FactorScore[] } {
  // P/E 不可用時改用銷售額及現金流；缺 P/E 不代表已確認虧損。
  const item = (sub: string, value: number | null, max: number, points: number): FactorScore => ({
    dimension: "估值", sub, score: valid(value) ? points : 0, max, available: valid(value),
  });
  if (!valid(v.pe) || v.pe <= 0) {
    const psScore = valid(v.ps) ? (v.ps > 0 ? scale((3 - v.ps) / 3, 8) : 0) : 0;
    const evScore = valid(v.evSales) ? (v.evSales > 0 ? scale((5 - v.evSales) / 5, 6) : 0) : 0;
    const fcfScore = valid(v.fcfYield) ? scale(v.fcfYield / 8, 6) : 0;
    return { score: psScore + evScore + fcfScore, factors: [
      item("P/S（替代估值）", v.ps, 8, psScore),
      item("EV/Sales（替代估值）", v.evSales, 6, evScore),
      item("現金流收益率", v.fcfYield, 6, fcfScore),
    ] };
  }
  const peScore = peBand(v.pe);
  const pegScore = valid(v.peg) ? (v.peg > 0 ? pegBand(v.peg) : 0) : 0;
  const pbScore = valid(v.pb) ? (v.pb > 0 ? pbBand(v.pb) : 0) : 0;
  return { score: peScore + pegScore + pbScore, factors: [
    item("P/E", v.pe, 8, peScore), { ...item("PEG", v.peg, 6, pegScore), note: v.pegBasis }, item("P/B", v.pb, 6, pbScore),
  ] };
}

// ---- 技術 30 ----
export function scoreTechnical(ind: IndicatorSnapshot): { score: number; factors: FactorScore[]; resonance: boolean } {
  const hasMA = [ind.ema20, ind.ema50, ind.ema200].every(valid);
  const hasMomentum = [ind.rsi, ind.macd, ind.macdSignal, ind.k, ind.d].every(valid);
  const hasWeighted = valid(ind.volumeWeightedPrice20) && valid(ind.lastClose);
  const ma = hasMA ? (ind.ema20 > ind.ema50 ? 5 : 0) + (ind.ema50 > ind.ema200 ? 5 : 0) : 0;
  const mom = hasMomentum ? (ind.rsi >= 40 && ind.rsi <= 70 ? 4 : ind.rsi > 70 ? 2 : 1)
    + (ind.macd > ind.macdSignal ? 3 : 0) + (ind.k > ind.d ? 3 : 0) : 0;
  const vp = hasWeighted && ind.lastClose > ind.volumeWeightedPrice20! ? 5 : 0;
  const hasResonance = hasMA && [ind.rsi, ind.macd, ind.macdSignal].every(valid);
  const resonance = hasResonance && ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200 && ind.rsi < 70 && ind.macd > ind.macdSignal;
  const resonanceScore = hasResonance ? (resonance ? 5 : 2) : 0;
  return { score: ma + mom + vp + resonanceScore, resonance, factors: [
    { dimension: "技術", sub: "均線排列(20/50/200)", score: ma, max: 10, available: hasMA },
    { dimension: "技術", sub: "動能(RSI/MACD/KD)", score: mom, max: 10, available: hasMomentum },
    { dimension: "技術", sub: "20日成交量加權均價", score: vp, max: 5, available: hasWeighted },
    { dimension: "技術", sub: "均線+動能共振", score: resonanceScore, max: 5, available: hasResonance },
  ] };
}

// ---- 情緒/宏觀 20 (代理指標) ----
export function scoreSentiment(r: Ratings | null, marketTrendUp: boolean | null, sectorStrong: boolean | null): { score: number; factors: FactorScore[]; proxies: string[] } {
  r = r && valid(r.ratingScore) && r.ratingScore >= 0 && r.ratingScore <= 5 ? r : null;
  const moat = r ? scale(r.ratingScore / 5, 8) : 0; // 代理：分析師評級
  const macro = (marketTrendUp === null ? 0 : marketTrendUp ? 4 : 1) + (sectorStrong === null ? 0 : sectorStrong ? 3 : 1); // 代理：大盤+產業
  const rating = r ? scale(r.ratingScore / 5, 5) : 0;
  const score = moat + macro + rating;
  return {
    score,
    proxies: ["護城河=分析師評級代理", "總經=SPY 趨勢+產業相對強弱代理"],
    factors: [
      { dimension: "情緒/宏觀", sub: "產業護城河(代理)", score: +moat.toFixed(1), max: 8, available: r !== null },
      { dimension: "情緒/宏觀", sub: "大盤趨勢(代理)", score: marketTrendUp === null ? 0 : marketTrendUp ? 4 : 1, max: 4, available: marketTrendUp !== null },
      { dimension: "情緒/宏觀", sub: "產業相對強弱(代理)", score: sectorStrong === null ? 0 : sectorStrong ? 3 : 1, max: 3, available: sectorStrong !== null },
      { dimension: "情緒/宏觀", sub: "財報/評級", score: +rating.toFixed(1), max: 5, available: r !== null },
    ],
  };
}

// ---- 彙總 + 分級 ----
// 僅描述模型分數，不將高分直接轉成買入推薦。
export function tierOf(total: number): string {
  if (total >= 80) return "模型評分偏強";
  if (total >= 65) return "模型評分中上";
  if (total >= 50) return "模型評分中性";
  return "模型評分偏弱";
}

function summarize(dimension: string, factors: FactorScore[]): DimensionScore {
  const max = factors.reduce((sum, f) => sum + f.max, 0);
  const availablePoints = factors.reduce((sum, f) => sum + (f.availableMax ?? (f.available === false ? 0 : f.max)), 0);
  const earnedPoints = factors.reduce((sum, f) => sum + f.score, 0);
  return {
    dimension, max, availablePoints: +availablePoints.toFixed(2), earnedPoints: +earnedPoints.toFixed(2),
    score: availablePoints > 0 ? Math.round(earnedPoints / availablePoints * 100) : null,
    coverage: max > 0 ? +(availablePoints / max * 100).toFixed(2) : 0,
    missing: factors.filter(f => f.available === false).map(f => f.missingInputs?.length ? f.missingInputs.join("、") : f.sub),
  };
}

export interface ScoreInput {
  financials: Financials | null;
  valuation: Valuation | null;
  ratings: Ratings | null;
  indicators: IndicatorSnapshot;
  marketTrendUp: boolean | null;
  sectorStrong: boolean | null;
}

export function score(input: ScoreInput): ScoreResult {
  const unavailable = (dimension: string, max: number) => ({
    score: 0,
    factors: [{ dimension, sub: "資料未知（不計分）", score: 0, max, available: false }],
  });
  const f = input.financials ? scoreFundamental(input.financials) : unavailable("基本面", 30);
  const v = input.valuation ? scoreValuation(input.valuation) : unavailable("估值", 20);
  const t = scoreTechnical(input.indicators);
  const s = scoreSentiment(input.ratings, input.marketTrendUp, input.sectorStrong);
  const factors: FactorScore[] = [...f.factors, ...v.factors, ...t.factors, ...s.factors];
  const dimensions = ["基本面", "估值", "技術", "情緒/宏觀"].map(name => summarize(name, factors.filter(f => f.dimension === name)));
  const overall = summarize("全部", factors);
  const missing = dimensions.flatMap(d => d.missing.map(name => `${d.dimension}：${name}`));
  return {
    total: overall.score,
    earnedPoints: overall.earnedPoints,
    tier: overall.score === null ? "未能評估" : missing.length ? "已知項目評分（非完整總評）" : tierOf(overall.score),
    dimensions,
    completeness: { percent: overall.coverage, availablePoints: overall.availablePoints, missing },
    factors, proxies: s.proxies,
  };
}
