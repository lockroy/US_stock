import { emaSeries, rollingVolumeWeightedPrice, validateCandles } from "../indicators/indicators";
import type {
  IndicatorSnapshot,
  ResearchMemo,
  TradeRule,
  TradePlan,
  AuditResult,
  AuditItem,
  BuyPoint,
  Candle,
  ScoreResult,
} from "../types";

// 找近期擺動高低點（簡化：區間極值）
function recentSwing(candles: Candle[], window = 60) {
  const slice = candles.slice(-window);
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return { high, low };
}

// ---- 研究備忘錄（五欄） ----
export function buildMemo(ind: IndicatorSnapshot, candles: Candle[]): ResearchMemo {
  const swing = recentSwing(candles);
  const trend =
    ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200
      ? "上升趨勢：均線多頭排列，更高低點結構"
      : ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200
      ? "下降趨勢：均線空頭排列"
      : "盤整：均線糾結，方向未明";
  const keyLevels = `支撐 ${swing.low.toFixed(2)}；壓力 ${swing.high.toFixed(2)}`;
  const momentum =
    ind.rsi > 70
      ? `動能強但過熱 (RSI ${ind.rsi.toFixed(0)})，留意拉回`
      : `動能 ${ind.rsi > 50 ? "改善" : "偏弱"} (RSI ${ind.rsi.toFixed(0)}, MACD線${ind.macd > ind.macdSignal ? "在訊號線上方" : ind.macd < ind.macdSignal ? "在訊號線下方" : "與訊號線相同"})`;
  const bandWidth = ((ind.bollUpper - ind.bollLower) / ind.bollMid) * 100;
  const volatility = `ATR ${ind.atr.toFixed(2)}，布林寬度 ${bandWidth.toFixed(1)}%：${bandWidth < 4 ? "收斂，可能即將擴張" : "中等波動"}`;
  const invalidation = `日線收盤跌破 ${swing.low.toFixed(2)} → 多頭結構失效（若為空方則收上 ${swing.high.toFixed(2)}）`;
  return { trend, keyLevels, momentum, volatility, invalidation };
}

// Nasdaq 日線的日期是 UTC 午夜標籤；美東時間 16:00 前不確認當日訊號。
// 提早收市日也保守等到 16:00，不推測交易日曆或供應商是否完成最後更新。
function closedDailyBar(time: number, asOf: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(asOf);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const day = new Date(time * 1000).toISOString().slice(0, 10);
  return day < today || (day === today && Number(part("hour")) >= 16);
}

// ---- 日線買點：所有條件只使用訊號日與之前的資料 ----
export function findBuyPoints(candles: Candle[], asOf = new Date()): BuyPoint[] {
  validateCandles(candles);
  if (candles.length < 200) return [];
  const points: BuyPoint[] = [];
  const closes = candles.map(c => c.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  for (let i = 199; i < candles.length; i++) {
    const current = candles[i];
    if (!closedDailyBar(current.time, asOf)) continue;
    const resistance = Math.max(...candles.slice(i - 5, i).map(c => c.high));
    const averageVolume = candles.slice(i - 20, i).reduce((sum, c) => sum + c.volume, 0) / 20;
    const weightedPrice = rollingVolumeWeightedPrice(candles.slice(i - 19, i + 1));
    const trend = ema20[i]! > ema50[i]! && ema50[i]! > ema200[i]! && current.close > ema20[i]!;
    const breakout = current.close > resistance;
    const volume = averageVolume > 0 && current.volume >= averageVolume * 1.5;
    if (trend && breakout && volume && weightedPrice !== null && current.close > weightedPrice) {
      points.push({ time: current.time, price: current.close,
        reason: "收盤突破前5根高點，成交量達前20根均量1.5倍，EMA20 > EMA50 > EMA200，且收盤高於EMA20及20日成交量加權均價" });
    }
  }
  return points.slice(-3);
}

// ---- 規則追溯（每買點對應規則） ----
export function buildRules(memo: ResearchMemo): TradeRule[] {
  return [
    {
      entry: "至少200根日線；收盤突破前5根高點；成交量達前20根均量1.5倍；EMA20 > EMA50 > EMA200；收盤高於EMA20及20日成交量加權均價",
      exit: "收在支撐下方或出現反向訊號",
      stop: memo.invalidation,
      size: "每筆風險 1%（ATR 倍數控倉）",
      timeframe: "日線收盤確認；需待下一交易時段評估執行",
    },
  ];
}

// ---- 交易計畫（支撐壓力 ± ATR） ----
export function buildPlan(ind: IndicatorSnapshot, candles: Candle[]): TradePlan {
  const swing = recentSwing(candles);
  const atr = ind.atr || ind.lastClose * 0.02;
  return {
    buyZone: `${swing.low.toFixed(2)} ~ ${swing.high.toFixed(2)}`,
    entry: ind.lastClose,
    target: +(swing.high + atr * 1).toFixed(2),
    stop: +(swing.low - atr * 1).toFixed(2),
  };
}

// 未執行的驗證保持未知；固定參數本身不是回測或費用證據。
export function audit(score: ScoreResult, memo: ResearchMemo, plan: TradePlan): AuditResult {
  const ordered = [plan.stop, plan.entry, plan.target].every(Number.isFinite)
    && plan.stop > 0 && plan.stop < plan.entry && plan.entry < plan.target;
  const rewardRisk = ordered ? (plan.target - plan.entry) / (plan.entry - plan.stop) : null;
  const items: AuditItem[] = [
    { name: "前視偏誤", pass: null, note: "未驗證資料時間點與訊號執行時序" },
    { name: "交易費用", pass: null, note: "未納入手續費、點差與滑價，淨風險回報未驗證" },
    { name: "過度擬合", pass: null, note: "未執行跨市場樣本外回測" },
    { name: "交易次數", pass: null, note: "未統計回測交易數與訊號頻率" },
    { name: "市場狀態依賴", pass: null, note: "未驗證不同市場狀態的表現" },
    { name: "價格次序", pass: ordered, note: ordered ? "停損 < 入場 < 目標" : "必須為有效正數，且停損 < 入場 < 目標" },
    { name: "風險回報", pass: rewardRisk !== null && rewardRisk >= 2, note: rewardRisk === null ? "價格次序無效，無法計算" : `毛風險回報 ${rewardRisk.toFixed(2)}，最低要求 2（未扣費用）` },
    { name: "失效條件", pass: memo.invalidation.trim().length > 0, note: memo.invalidation.trim() || "未定義失效條件" },
    { name: "評分資料", pass: score.completeness.percent === 100 ? true : null, note: `可用評分資料 ${score.completeness.percent}%；模擬模式不代表真實資料已驗證` },
  ];
  const verdict = items.some(item => item.pass === false) ? "拒絕"
    : items.some(item => item.pass === null) ? "未驗證" : "核准";
  return { items, verdict };
}
