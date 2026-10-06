import type { Candle, IndicatorSnapshot } from "../types";

export type { Candle };

function validatePeriod(period: number) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("指標週期必須為正整數");
}

function validateValues(values: number[]) {
  if (values.some(value => !Number.isFinite(value))) throw new RangeError("指標資料必須為有限數值");
}

function requireHistory(values: number[], period: number) {
  validatePeriod(period);
  validateValues(values);
  if (values.length < period) throw new RangeError(`指標至少需要 ${period} 筆資料`);
}

// SMA 初始化；null 表示尚未完成暖機，不拿最後價格代替 EMA。
export function emaSeries(values: number[], period: number): (number | null)[] {
  validatePeriod(period);
  validateValues(values);
  const result: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return result;
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous += alpha * (values[i] - previous);
    result[i] = previous;
  }
  return result;
}

export function ema(values: number[], period: number): number {
  requireHistory(values, period);
  return emaSeries(values, period)[values.length - 1]!;
}

function sma(values: number[], period: number): number {
  requireHistory(values, period);
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

// Wilder RSI：初始平均漲跌幅為 SMA，後續以 1/period 遞迴平滑。
export function rsi(closes: number[], period = 14): number {
  validatePeriod(period);
  requireHistory(closes, period + 1);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

// MACD(12,26,9)：兩條 EMA 均以 SMA 初始化；EMA9 使用完整的有效 MACD 序列。
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): {
  macd: number | null; signal: number | null; hist: number | null;
} {
  [fast, slow, signalPeriod].forEach(validatePeriod);
  if (fast >= slow) throw new RangeError("MACD 快線週期必須小於慢線");
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  if (closes.length < slow) return { macd: null, signal: null, hist: null };
  const lines = closes.slice(slow - 1).map((_, i) => fastSeries[i + slow - 1]! - slowSeries[i + slow - 1]!);
  const line = lines[lines.length - 1];
  const signals = emaSeries(lines, signalPeriod);
  const signal = signals[signals.length - 1];
  return { macd: line, signal, hist: signal === null ? null : line - signal };
}

// KD(9,3,3)：RSV 為 9 根高低區間；K、D 從 50 開始，以 1/3 遞迴平滑。
export function stochastic(highs: number[], lows: number[], closes: number[], period = 9): { k: number; d: number } {
  requireHistory(closes, period);
  validateValues(highs);
  validateValues(lows);
  if (highs.length !== closes.length || lows.length !== closes.length) throw new RangeError("KD 資料長度不一致");
  let k = 50;
  let d = 50;
  for (let i = period - 1; i < closes.length; i++) {
    const high = Math.max(...highs.slice(i - period + 1, i + 1));
    const low = Math.min(...lows.slice(i - period + 1, i + 1));
    if (high < low || closes[i] < low || closes[i] > high) throw new RangeError("KD 價格區間無效");
    const rsv = high === low ? 50 : (closes[i] - low) / (high - low) * 100;
    k = (2 * k + rsv) / 3;
    d = (2 * d + k) / 3;
  }
  return { k, d };
}

export function bollinger(closes: number[], period = 20, mult = 2): { upper: number; mid: number; lower: number } {
  const mid = sma(closes, period);
  const variance = closes.slice(-period).reduce((sum, value) => sum + (value - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
}

export function validateCandles(candles: Candle[]): void {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
      || c.time < 0 || c.low <= 0 || c.volume < 0
      || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)
      || (i > 0 && c.time <= candles[i - 1].time)) {
      throw new RangeError("K 線必須為有效 OHLCV，時間遞增且不重複");
    }
  }
}

// Wilder ATR：第一筆 TR 為 high-low，後續 TR 包含隔日跳空，再以 1/period 平滑。
export function atr(candles: Candle[], period = 14): number {
  validatePeriod(period);
  validateCandles(candles);
  if (candles.length < period) throw new RangeError(`ATR 至少需要 ${period} 根 K 線`);
  const ranges = candles.map((c, i) => i === 0 ? c.high - c.low
    : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
  let result = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < ranges.length; i++) result = (result * (period - 1) + ranges[i]) / period;
  return result;
}

// 指定輸入區間的 typical-price 成交量加權均價，並非盤中逐筆成交 VWAP。
export function volumeWeightedPrice(candles: Candle[]): number | null {
  validateCandles(candles);
  let weighted = 0;
  let volume = 0;
  for (const c of candles) {
    weighted += ((c.high + c.low + c.close) / 3) * c.volume;
    volume += c.volume;
  }
  return volume === 0 ? null : weighted / volume;
}

export function rollingVolumeWeightedPrice(candles: Candle[], period = 20): number | null {
  validatePeriod(period);
  if (candles.length < period) return null;
  return volumeWeightedPrice(candles.slice(-period));
}

export function computeIndicators(candles: Candle[]): IndicatorSnapshot {
  validateCandles(candles);
  if (candles.length < 200) throw new RangeError("完整指標需要至少 200 根日線");
  const closes = candles.map(c => c.close);
  const m = macd(closes);
  const st = stochastic(candles.map(c => c.high), candles.map(c => c.low), closes);
  const boll = bollinger(closes);
  return {
    ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200),
    rsi: rsi(closes), macd: m.macd!, macdSignal: m.signal!, macdHist: m.hist!,
    k: st.k, d: st.d,
    bollUpper: boll.upper, bollMid: boll.mid, bollLower: boll.lower,
    atr: atr(candles), volumeWeightedPrice20: rollingVolumeWeightedPrice(candles),
    lastClose: closes[closes.length - 1],
  };
}
