import { rsi, ema, computeIndicators, type Candle } from "./indicators";

function approx(a: number, b: number, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`期望 ${b}，得到 ${a}`);
  console.log(`✓ ${a}`);
}

// RSI 單調上漲序列 → 應為 100
const up = Array.from({ length: 30 }, (_, i) => 100 + i);
approx(rsi(up), 100);

// EMA 常數序列 → 等於該值
approx(ema([5, 5, 5, 5, 5], 3), 5);

// 指標快照不拋錯且有合理數值
const candles: Candle[] = Array.from({ length: 250 }, (_, i) => {
  const close = 100 + Math.sin(i / 10) * 10 + i * 0.05;
  return { time: i, open: close, high: close + 1, low: close - 1, close, volume: 1000 };
});
const snap = computeIndicators(candles);
if (!(snap.rsi >= 0 && snap.rsi <= 100)) throw new Error("RSI 越界");
if (!(snap.atr >= 0)) throw new Error("ATR 負值");
console.log("✓ computeIndicators 通過, RSI=", snap.rsi.toFixed(2), "ATR=", snap.atr.toFixed(2));
console.log("全部指標測試通過 ✅");
