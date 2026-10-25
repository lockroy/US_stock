import type { StockReport } from "../types";

export interface MissingDataItem {
  id: string;
  group: string;
  label: string;
  status: "未取得" | "未確認" | "不可用" | "不適用";
  impact: string;
}

// 每個獨立輸入只計一次：例如評級同時供兩個評分代理使用，仍只算一項。
export function missingDataSummary(report: StockReport) {
  const items = new Map<string, MissingDataItem>();
  const add = (id: string, group: string, label: string, impact: string, status: MissingDataItem["status"] = "未取得") => {
    items.set(id, { id, group, label, impact, status });
  };
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  for (const [key, label] of [["change", "報價漲跌"], ["changePct", "漲跌百分比"], ["volume", "報價成交量"]] as const) {
    if (!finite(report.quote[key])) add(`quote.${key}`, "報價", label, "報價資訊不完整；技術量價條件另按日線成交量判斷");
  }
  if (!report.quote.asOf?.trim()) add("quote.asOf", "報價", "供應商報價時間", "未能確認報價對應時間；讀取時間不能代替成交時間", "未確認");
  if (typeof report.quote.isRealTime !== "boolean") add("quote.isRealTime", "報價", "即時／延遲狀態", "下單前需核對即時成交價", "未確認");

  for (const [key, label] of [
    ["revenueGrowth", "營收增長"], ["epsGrowth", "EPS 增長"], ["grossMargin", "毛利率"],
    ["roe", "ROE"], ["roic", "ROIC"], ["debtToEquity", "負債權益比"], ["fcf", "自由現金流"],
  ] as const) {
    if (!finite(report.financials?.[key])) add(`financials.${key}`, "基本面", label,
      `${report.financials?.notes?.[key] ?? ""} 基本面評分只計已知項目；完整基本面策略尚未能確認`.trim(),
      key === "epsGrowth" && report.financials?.epsEvidence ? "不適用" : "未取得");
  }
  if (!finite(report.financials?.netIncomeGrowth)) add("financials.netIncomeGrowth", "財務補充", "淨利增長", "補充財務資訊未取得；不作 EPS 替代，亦不直接參與評分");

  for (const factor of report.score.factors.filter(f => f.available === false)) {
    if (factor.dimension === "基本面") continue; // 上面已逐個列出，而非再計整組缺失
    if (factor.dimension === "技術" && factor.sub === "20日成交量加權均價") {
      add("technical.volume", "技術資料可用性", "日線成交量／20日成交量加權均價", "量價資料不足，不能確認量價條件", "不可用");
    } else if (factor.dimension === "情緒/宏觀" && /護城河|評級/.test(factor.sub)) {
      add("ratings", "情緒／宏觀", "分析師評級", "評級及護城河代理未能評估；不直接封鎖技術策略");
    } else {
      add(`factor.${factor.dimension}.${factor.sub}`, factor.dimension, factor.sub,
        factor.dimension === "估值" ? "估值只計已知項目；完整估值策略尚未能確認" : "相關評分項目未能評估；技術入場條件另行檢查");
    }
  }
  if (report.sources.ratings === "unknown") add("ratings", "情緒／宏觀", "分析師評級", "評級及護城河代理未能評估；不直接封鎖技術策略");
  if (report.candlesIntraday.length === 0) add("intraday", "圖表", "真實分時行情", "未能提供分時分析；日線技術策略仍可獨立判斷");

  const pausedNews = report.newsStatus === "disabled";
  if (!pausedNews && report.mode === "real" && report.newsStatus !== "empty"
    && (report.newsStatus === "unavailable" || report.newsStatus === "rate_limited" || report.sources.news === "unknown")) {
    add("news", "新聞", "新聞資料", "新聞未能讀取；不參與評分或入場訊號");
  }
  for (const check of report.strategy.technical.checks.filter(c => c.pass === null)) {
    // 報價缺項已於報價組列出；其餘為日線／量價資料可用性問題。
    if (check.name === "入場參考報價") continue;
    if (check.name === "成交量可用性") {
      add("technical.volume", "技術資料可用性", "日線成交量／20日成交量加權均價", check.note, "不可用");
      continue;
    }
    add(`technical.${check.name}`, "技術資料可用性", check.name, check.note, "不可用");
  }
  const pendingValidation = report.audit.items.filter(item => item.pass === null
    && !["評分資料", "價格次序", "風險回報"].includes(item.name));
  return { items: [...items.values()], pausedNews, pendingValidation };
}
