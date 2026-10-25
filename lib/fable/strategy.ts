import { computeIndicators, validateCandles } from "../indicators/indicators";
import type { Candle, Quote, ScoreResult, StrategyAssessment, StrategyCheck } from "../types";
import { buildPlan, closedDailyBar } from "./fable";
import { checkQuoteDate } from "./timeliness";
import { lastCompletedSession, marketSession } from "../market/calendar";

// 研究參數，沿用原本 65 分模型分界及 2:1 毛風險回報要求；尚未經回測校準。
export const FUNDAMENTAL_THRESHOLD = 65;
export const MIN_REWARD_RISK = 2;

export function assessStrategy(
  score: ScoreResult, candles: Candle[], quote: Quote, asOf = new Date(),
): StrategyAssessment {
  const caveats = [
    "模型研究訊號，未經手續費、點差、滑價及樣本外回測驗證。",
    "技術條件以最後可用已收盤日線評估；歷史買點不等於目前入場訊號。",
    "資料覆蓋率不是準確率或獲利機率；缺項可能改變結論。",
  ];
  if (quote.isRealTime !== true) caveats.push("報價未確認為即時；實際下單前須重新核對成交價及風險回報。");
  const fundamentalChecks: StrategyCheck[] = ["基本面", "估值"].map(name => {
    const d = score.dimensions.find(d => d.dimension === name);
    const complete = d && d.missing.length === 0 && d.availablePoints === d.applicablePoints && d.score !== null;
    return {
      name: `${name}研究門檻`, pass: complete ? d.score! >= FUNDAMENTAL_THRESHOLD : null,
      note: complete ? `${d.score}/100；適用項目資料已齊${d.notApplicable.length ? `（${d.notApplicable.join("、")}不適用，已排除）` : ""}；研究門檻 ${FUNDAMENTAL_THRESHOLD}，不代表已出現買點`
        : `資料不足，未能完整判斷${name}；缺失：${d?.missing.join("、") || "未取得資料"}`,
    };
  });
  const fundamental: StrategyAssessment["fundamental"] = {
    status: fundamentalChecks.some(c => c.pass === false) ? "條件不符合"
      : fundamentalChecks.some(c => c.pass === null) ? "資料不足" : "等待觸發",
    checks: fundamentalChecks,
  };
  if (fundamental.status === "資料不足") caveats.push("基本面或估值未確認；技術機會不代表公司質素或估值已通過審查。");
  if (fundamental.status === "條件不符合") caveats.push("基本面或估值未達研究門檻；技術訊號不能取代此項風險。");

  const technical: StrategyAssessment["technical"] = {
    status: "資料不足", checks: [], evaluatedBarTime: null, referencePlan: null, rewardRisk: null,
  };
  const result = { technical, fundamental, caveats };
  const finish = () => {
    if (fundamentalChecks.every(c => c.pass === true)) {
      // 財務研究門檻通過後，仍需同一組有效技術入場條件，不能單靠高分買入。
      fundamental.status = technical.status;
      fundamental.checks = [...fundamentalChecks, {
        name: "技術入場條件", pass: technical.status === "符合入場條件" ? true : technical.status === "資料不足" ? null : false,
        note: `財務研究門檻已通過；技術策略目前為「${technical.status}」`,
      }];
    }
    return result;
  };
  try { validateCandles(candles); }
  catch {
    technical.checks.push({ name: "日線格式", pass: null, note: "日線格式無效，不產生入場參考" });
    return finish();
  }
  // 日線已驗證遞增，只需從末尾找收盤邊界，避免逐根重建時區格式器。
  let lastClosed = candles.length - 1;
  while (lastClosed >= 0 && !closedDailyBar(candles[lastClosed].time, asOf)) lastClosed--;
  const closed = candles.slice(0, lastClosed + 1);
  technical.evaluatedBarTime = closed.at(-1)?.time ?? null;
  technical.checks.push({ name: "已收盤日線", pass: closed.length >= 200 ? true : null, note: `${closed.length} 根；至少需要 200 根` });
  if (closed.length < 200) return finish();
  const latest = closed[closed.length - 1];
  const latestDay = new Date(latest.time * 1000).toISOString().slice(0, 10);
  const expected = lastCompletedSession(asOf);
  technical.checks.push({ name: "日線時效", pass: expected !== null && latestDay === expected ? true : null,
    note: `最後已收盤日線 ${latestDay}；第三方日曆預期 ${expected ?? "未知（超出參考範圍）"}。週末、假期與提早收市按參考日曆判斷，臨時停市公告未即時核實。` });
  const invalidSessions = closed.filter(c => marketSession(new Date(c.time * 1000).toISOString().slice(0, 10)).kind === "closed");
  technical.checks.push({ name: "日線交易日一致性", pass: invalidSessions.length === 0 ? true : null,
    note: invalidSessions.length ? `${invalidSessions.length} 根日線日期在參考日曆為休市；不刪改來源，暫停當前入場。` : "參考範圍內沒有發現休市日 K 線；範圍外歷史日期未核實。" });
  technical.checks.push(checkQuoteDate(quote, latest.time, asOf));
  const ind = computeIndicators(closed);
  const averageVolume = closed.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
  const hasVolume = averageVolume > 0 && latest.volume > 0 && ind.volumeWeightedPrice20 !== null;
  technical.checks.push({ name: "成交量可用性", pass: hasVolume ? true : null,
    note: hasVolume ? "訊號日及前 20 根日線具有效成交量" : "零成交量無法確認量價訊號；不當作利淡或以假設成交量補缺" });
  const usablePrice = Number.isFinite(quote.lastPrice) && quote.lastPrice > 0;
  technical.checks.push({ name: "入場參考報價", pass: usablePrice ? true : null, note: usablePrice ? "採用本次供應商報價，實際執行需重新核價" : "缺少有效報價，不產生入場參考" });
  const usableATR = Number.isFinite(ind.atr) && ind.atr > 0;
  technical.checks.push({ name: "止損距離", pass: usableATR ? true : false,
    note: usableATR ? `實際 ATR ${ind.atr.toFixed(2)}` : "ATR 為零或無效，無法建立此策略的波動止損" });
  if (technical.checks.some(c => c.pass === null)) return finish();
  if (!usableATR) { technical.status = "條件不符合"; return finish(); }

  const plan = { ...buildPlan(ind, closed), entry: quote.lastPrice };
  const ordered = [plan.stop, plan.entry, plan.target].every(Number.isFinite)
    && plan.stop > 0 && plan.stop < plan.entry && plan.entry < plan.target;
  const rewardRisk = ordered ? (plan.target - plan.entry) / (plan.entry - plan.stop) : null;
  technical.referencePlan = ordered ? plan : null;
  technical.rewardRisk = rewardRisk;
  const bearish = ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;
  const trend = ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200 && latest.close > ind.ema20;
  const resistance = Math.max(...closed.slice(-6, -1).map(c => c.high));
  const breakout = latest.close > resistance;
  const volume = latest.volume >= averageVolume * 1.5;
  const weighted = latest.close > ind.volumeWeightedPrice20!;
  const entryHolds = quote.lastPrice > resistance && quote.lastPrice > ind.ema20
    && quote.lastPrice > ind.volumeWeightedPrice20!;
  technical.checks.push(
    { name: "價格次序", pass: ordered, note: "必須為正數且停損 < 入場參考 < 目標" },
    { name: "毛風險回報", pass: rewardRisk !== null && rewardRisk >= MIN_REWARD_RISK,
      note: rewardRisk === null ? "價格次序無效，無法計算" : `${rewardRisk.toFixed(2)}:1；最低 ${MIN_REWARD_RISK}:1，未扣費用` },
    { name: "均線趨勢", pass: trend, note: "EMA20 > EMA50 > EMA200，且收盤高於 EMA20" },
    { name: "收盤突破", pass: breakout, note: `突破前 5 根高點 ${resistance.toFixed(2)}` },
    { name: "成交量觸發", pass: volume, note: `訊號日成交量須達前 20 根均量 1.5 倍（${Math.ceil(averageVolume * 1.5)}）` },
    { name: "量價支持", pass: weighted, note: "收盤高於 20 日成交量加權均價" },
    { name: "報價維持突破", pass: entryHolds, note: "本次報價仍高於突破位、EMA20 及 20 日成交量加權均價；不追認已失效訊號" },
  );
  technical.status = !ordered || rewardRisk === null || rewardRisk < MIN_REWARD_RISK || bearish ? "條件不符合"
    : trend && breakout && volume && weighted && entryHolds ? "符合入場條件" : "等待觸發";
  return finish();
}
