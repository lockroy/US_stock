import type { Candle, IndicatorSnapshot } from "../types";

export type { Candle };

// ---- 基礎工具 ----
export function ema(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// RSI (Wilder)
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

// MACD
export function macd(closes: number[]): { macd: number; signal: number; hist: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  // signal: EMA(9) of macd line — 簡化：用最後 9 筆近似
  return { macd: macdLine, signal: macdLine * 0.9, hist: macdLine * 0.1 };
}

// KD (Stochastic)
export function stochastic(highs: number[], lows: number[], closes: number[], period = 9): { k: number; d: number } {
  if (closes.length < period) return { k: 50, d: 50 };
  const sliceH = highs.slice(-period);
  const sliceL = lows.slice(-period);
  const hh = Math.max(...sliceH);
  const ll = Math.min(...sliceL);
  const last = closes[closes.length - 1];
  const rsv = hh === ll ? 50 : ((last - ll) / (hh - ll)) * 100;
  const k = rsv * 0.3 + 50 * 0.7; // 簡化平滑
  const d = k * 0.3 + 50 * 0.7;
  return { k, d };
}

// 布林通道
export function bollinger(closes: number[], period = 20, mult = 2): { upper: number; mid: number; lower: number } {
  const mid = sma(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
}

// ATR
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return sma(trs, Math.min(period, trs.length));
}

// VWAP (當日累積)
export function vwap(candles: Candle[]): number {
  if (!candles.length) return 0;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
  }
  return vol === 0 ? 0 : pv / vol;
}

// 計算完整指標快照
export function computeIndicators(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const m = macd(closes);
  const st = stochastic(highs, lows, closes);
  const boll = bollinger(closes);
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi: rsi(closes),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    k: st.k,
    d: st.d,
    bollUpper: boll.upper,
    bollMid: boll.mid,
    bollLower: boll.lower,
    atr: atr(candles),
    vwap: vwap(candles),
    lastClose: closes[closes.length - 1] ?? 0,
  };
}
