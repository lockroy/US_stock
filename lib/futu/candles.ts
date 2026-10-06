import type { Candle } from "../types";
import { validateCandles } from "../indicators/indicators";

// Nasdaq 的日線日期使用 UTC 午夜；每週以週一、每月以一日作為桶標籤。
export function aggregateCandles(daily: Candle[], range: "week" | "month"): Candle[] {
  validateCandles(daily);
  const result: Candle[] = [];
  for (const candle of daily) {
    const date = new Date(candle.time * 1000);
    date.setUTCHours(0, 0, 0, 0);
    if (range === "month") date.setUTCDate(1);
    else date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const time = date.getTime() / 1000;
    const previous = result[result.length - 1];
    if (previous?.time === time) {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = candle.close;
      previous.volume += candle.volume;
    } else result.push({ ...candle, time });
  }
  return result;
}
