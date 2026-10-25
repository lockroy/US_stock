import type { EpsEvidence, EpsVersion } from "../types";
import { normalizeTicker } from "./symbol";

export interface EpsResult {
  status: "ready" | "not_configured" | "unavailable" | "incomparable";
  growth: number | null;
  evidence?: EpsEvidence;
  versions?: EpsVersion[];
  message: string;
}

// 按申報日期重建同一財年的 EPS 版本；不把後來重述值倒填到較早決策日。
export function parseEpsVersions(data: unknown, cik: string, periodEnd: string, asOf = new Date()): EpsVersion[] {
  const root = object(data), gaap = object(object(root?.facts)?.["us-gaap"]);
  const rows = object(object(gaap?.EarningsPerShareDiluted)?.units)?.["USD/shares"];
  const target = financialEnd(periodEnd), today = asOf.toISOString().slice(0, 10);
  if (!/^\d{10}$/.test(cik) || Number(cik) <= 0 || root?.cik !== Number(cik) || !Array.isArray(rows) || !target) return [];
  const filings = new Map<string, Row>();
  for (const item of rows) {
    const r = object(item);
    if (!r || r.end !== target || typeof r.filed !== "string" || day(r.filed) === null || r.filed > today
      || typeof r.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(r.accn)
      || !["10-K", "10-K/A", "20-F", "20-F/A"].includes(String(r.form))) continue;
    filings.set(`${r.filed}/${r.accn}`, r);
  }
  return [...filings.values()].sort((a, b) => String(a.filed).localeCompare(String(b.filed)) || String(a.accn).localeCompare(String(b.accn))).map(r => {
    const parsed = parseAnnualEps(data, cik, periodEnd, new Date(`${r.filed}T23:59:59Z`));
    const evidence = parsed.evidence?.accession === r.accn ? parsed.evidence : undefined;
    return { filed: String(r.filed), accession: String(r.accn), form: String(r.form), status: evidence ? "ready" : "incomparable",
      current: evidence?.current ?? null, previous: evidence?.previous ?? null, growth: evidence ? parsed.growth : null,
      usableFromDate: new Date((day(r.filed)! + 1) * 86400000).toISOString().slice(0, 10) };
  });
}

// 申報只有日期沒有接受時間，保守排除決策日當天的申報；最新版本不可用時不退回舊值。
export function selectEpsVersion(versions: EpsVersion[], decisionDate: string): EpsVersion | null {
  if (day(decisionDate) === null) return null;
  const available = versions.filter(v => day(v.filed) !== null && v.filed < decisionDate && v.usableFromDate <= decisionDate);
  const latest = available.map(v => v.filed).sort().at(-1);
  const matches = available.filter(v => v.filed === latest);
  return matches.length === 1 && matches[0].status === "ready" ? matches[0] : null;
}
export type EpsProvider = (symbol: string, periodEnd: string) => Promise<EpsResult>;
type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const day = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86400000 : null;
};
export function financialEnd(value: string): string | null {
  if (day(value) !== null) return value;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return day(iso) !== null ? iso : null;
}
const unknown = (message: string, status: EpsResult["status"] = "incomparable"): EpsResult => ({ status, growth: null, message });
let nextRequest = 0;

// 同一 CIK 多個 ticker 可能為不同股份類別／ADR；未核對每股口徑前不自動套用。
export function resolveSecCik(data: unknown, symbol: string): string | null {
  const ticker = normalizeTicker(symbol)?.replace(/[.-]/g, ".");
  const entries = object(data);
  if (!ticker || !entries) return null;
  const rows = Object.values(entries).map(object).filter((r): r is Row => r !== null);
  const normalized = (r: Row) => typeof r.ticker === "string" ? normalizeTicker(r.ticker)?.replace(/[.-]/g, ".") : null;
  const matches = rows.filter(r => normalized(r) === ticker);
  if (matches.length !== 1) return null;
  const cik = matches[0].cik_str;
  if (!Number.isSafeInteger(cik) || Number(cik) <= 0 || Number(cik) > 9999999999) return null;
  if (new Set(rows.filter(r => r.cik_str === cik).map(normalized)).size !== 1) return null;
  return String(cik).padStart(10, "0");
}

// 年度攤薄 EPS：同一申報同時披露的本期及上期，避免不同申報重述／拆股口徑混用。
export function parseAnnualEps(data: unknown, cik: string, periodEnd: string, asOf = new Date()): EpsResult {
  const root = object(data);
  const target = financialEnd(periodEnd);
  if (!root || !/^\d{10}$/.test(cik) || Number(cik) <= 0 || !Number.isSafeInteger(root.cik)
    || root.cik !== Number(cik) || !target) return unknown("SEC 公司或財年未能對齊，EPS 保持未知。");
  const facts = object(root.facts), gaap = object(facts?.["us-gaap"]);
  const metric = object(gaap?.EarningsPerShareDiluted), units = object(metric?.units);
  if (!Array.isArray(units?.["USD/shares"])) return unknown("未取得可比的美元年度攤薄 EPS；不以基本 EPS、其他幣種或淨利代替。");
  const today = day(asOf.toISOString().slice(0, 10))!;
  const allRows = (units["USD/shares"] as unknown[]).map(object).filter((r): r is Row => r !== null);
  const latestFiled = allRows.filter(r => r.end === target && typeof r.filed === "string"
    && day(r.filed) !== null && day(r.filed)! <= today && ["10-K", "10-K/A", "20-F", "20-F/A"].includes(String(r.form)))
    .map(r => String(r.filed)).sort().at(-1);
  const rows = (units["USD/shares"] as unknown[]).map(object).filter((r): r is Row => {
    if (!r || typeof r.val !== "number" || !Number.isFinite(r.val) || !["10-K", "10-K/A", "20-F", "20-F/A"].includes(String(r.form))
      || typeof r.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(r.accn) || r.fp !== "FY") return false;
    const start = day(r.start), end = day(r.end), filed = day(r.filed);
    return start !== null && end !== null && filed !== null && filed >= end && filed <= today
      && end - start >= 330 && end - start <= 380;
  });
  const currentRows = rows.filter(r => r.end === target).sort((a, b) => String(b.filed).localeCompare(String(a.filed)));
  const current = currentRows[0];
  if (!current) return unknown("未找到與現有財年一致的年度攤薄 EPS。");
  if (current.filed !== latestFiled || new Set(currentRows.filter(r => r.filed === latestFiled).map(r => r.accn)).size !== 1) {
    return unknown("最新年度 EPS 申報無法唯一核對，不改用較舊數值。");
  }
  // 最新申報缺可比資料時不悄悄改用舊申報；同一申報若有衝突值則拒絕。
  const sameFiling = rows.filter(r => r.accn === current.accn && r.filed === current.filed && r.form === current.form);
  const currentValues = sameFiling.filter(r => r.end === target);
  const previousRows = sameFiling.filter(r => {
    const gap = day(target)! - day(r.end)!;
    return gap >= 330 && gap <= 380 && Math.abs((day(current.end)! - day(current.start)!) - (day(r.end)! - day(r.start)!)) <= 10;
  });
  const unique = (values: Row[]) => new Set(values.map(r => JSON.stringify([r.start, r.end, r.val]))).size;
  if (unique(currentValues) !== 1 || unique(previousRows) !== 1) return unknown("同一申報的年度 EPS 缺失或有衝突，不能確認同比增長。");
  const previous = previousRows[0];
  const evidence: EpsEvidence = {
    source: "sec", cik, metric: "EarningsPerShareDiluted", unit: "USD/shares",
    current: current.val as number, previous: previous.val as number,
    currentStart: current.start as string, currentEnd: current.end as string,
    previousStart: previous.start as string, previousEnd: previous.end as string,
    filed: current.filed as string, accession: current.accn as string, form: current.form as string,
    url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  };
  const growth = evidence.previous > 0 ? (evidence.current - evidence.previous) / evidence.previous * 100 : null;
  return { status: "ready", growth: growth !== null && Number.isFinite(growth) ? growth : null, evidence,
    message: growth === null ? "已取得 SEC 年度攤薄 EPS，但上期非正數，同比百分比不適用。"
      : "SEC 同一申報的年度攤薄 EPS 同比增長；不是分析師預期增長。" };
}

// 無 API key／收費；只有設定真實聯絡識別後才會請求 SEC。失敗不補假資料。
export async function fetchAnnualEps(symbol: string, periodEnd: string): Promise<EpsResult> {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent || !/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/.test(userAgent) || /[\r\n]/.test(userAgent)) {
    return unknown("SEC 尚未設定含真實聯絡電郵的 SEC_USER_AGENT；EPS 保持未知。", "not_configured");
  }
  if (!normalizeTicker(symbol) || !financialEnd(periodEnd)) return unknown("股票代號或財年格式無效。");
  const request = async (url: string, revalidate: number) => {
    // 每個執行個體最多約每秒四次；跨 Worker 不能以此承諾全域速率。
    const delay = Math.max(0, nextRequest - Date.now());
    if (delay > 2000) throw new Error("SEC_LOCAL_RATE_LIMIT");
    nextRequest = Math.max(Date.now(), nextRequest) + 250;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(8000), redirect: "manual", next: { revalidate } });
    if (!response.ok) throw new Error("SEC_UNAVAILABLE");
    return response.json();
  };
  try {
    const directory = await request("https://www.sec.gov/files/company_tickers.json", 86400);
    const cik = resolveSecCik(directory, symbol);
    if (!cik) return unknown("SEC 代號／CIK 或股份類別未能唯一核對，EPS 保持未知。");
    const facts = await request(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 3600);
    return { ...parseAnnualEps(facts, cik, periodEnd), versions: parseEpsVersions(facts, cik, periodEnd) };
  } catch { return unknown("SEC 資料暫時無法讀取；EPS 保持未知，不影響其他已取得資料。", "unavailable"); }
}
