"use client";

import { useQuery } from "@tanstack/react-query";
import { Chart } from "@/components/Chart";
import { MissingDataSummary } from "./MissingDataSummary";
import { ComparabilityPanel } from "./ComparabilityPanel";
import type { StockReport, Financials, StrategyCheck } from "@/lib/types";
import { normalizeTicker } from "@/lib/futu/symbol";

import { tierColor } from "@/lib/scoring/presentation";

// 數據來源標籤
const SOURCE_LABEL: Record<string, string> = {
  nasdaq: "Nasdaq 資料",
  sec: "SEC 原始申報",
  finnhub: "Finnhub 真實",
  google_news: "Google News RSS",
  derived: "推導計算",
  mock: "模擬數據",
  proxy: "代理假設",
  unknown: "未知 / 未取得",
};
const SOURCE_COLOR: Record<string, string> = {
  nasdaq: "#22c55e",
  sec: "#22c55e",
  finnhub: "#22c55e",
  google_news: "#22c55e",
  derived: "#58a6ff",
  mock: "#f59e0b",
  proxy: "#8b949e",
  unknown: "#8b949e",
};
const SOURCE_KEY_LABEL: Record<string, string> = {
  quote: "報價",
  candlesDaily: "日線",
  candlesIntraday: "分時",
  financials: "財務",
  epsGrowth: "EPS",
  valuation: "估值",
  marketCap: "市值",
  ratings: "評級",
  news: "新聞",
  marketTrendUp: "大盤",
  sectorStrong: "產業",
  indicators: "指標",
  scoring: "評分",
};

// 每個數據區塊的「源頭出處」說明（給 fact-check 用）
// key 對應 sources 的 key，value 是給人讀的中文說明，標示從哪個檔/端點來的
const SOURCE_PROVENANCE: Record<string, string> = {
  quote: "lib/futu/nasdaq.ts → fetchVerifiedQuote()｜Nasdaq /api/quote/{t}/info",
  candlesDaily: "lib/futu/nasdaq.ts → fetchDaily()｜Nasdaq /api/quote/{t}/historical",
  candlesIntraday: "尚未接入真實分時資料",
  financials: "lib/futu/nasdaq.ts → fetchFinancials()｜Nasdaq /api/company/{t}/financials",
  epsGrowth: "SEC Company Facts｜同一申報、同幣種、同年度口徑的攤薄 EPS；不是淨利增長或分析師預期",
  valuation: "lib/futu/nasdaq.ts → deriveValuation()｜市值÷財務數字推導",
  marketCap: "Nasdaq summary → MarketCap；按需讀取、不快取；供應商更新時間及頻率未知",
  ratings: "尚未接入真實評級資料",
  news: "Google News RSS｜最近七日代號搜尋，顯示出版來源、發布時間及 Google 原文跳轉連結；未取得時標示未知",
  marketTrendUp: "lib/futu/nasdaq.ts → fetchEtfDaily(SPY)｜Nasdaq /api/quote/SPY/historical",
  sectorStrong: "lib/futu/nasdaq.ts → fetchEtfDaily(sector ETF)｜Nasdaq /api/quote/{ETF}/historical",
  indicators: "lib/indicators/indicators.ts｜由 candlesDaily 本地計算（EMA/RSI/MACD/KD/布林/ATR/20日成交量加權均價）",
  scoring: "本地研究模型：基本面30、估值20、技術30、情緒20；只按已知權重正規化，非買賣指令",
};

const FINANCIAL_FIELDS: [keyof Financials, string, string][] = [
  ["revenueGrowth", "營收增長", "%"], ["epsGrowth", "EPS 增長", "%"],
  ["netIncomeGrowth", "淨利增長（不是 EPS）", "%"], ["grossMargin", "毛利率", "%"],
  ["roe", "ROE", "%"], ["roic", "簡化 ROIC（推導）", "%"],
  ["debtToEquity", "負債權益比", ""], ["fcf", "自由現金流", " 千美元"],
];

function Block({ n, title, fable, children }: { n: number; title: string; fable?: boolean; children: React.ReactNode }) {
  return (
    <section className="card p-4 mb-4">
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <span className="text-accent">{n}.</span>
        {title}
        {fable && <span className="text-[10px] bg-fable text-white px-2 py-0.5 rounded-full">Fable</span>}
      </h2>
      {children}
    </section>
  );
}

function StrategyChecks({ checks }: { checks: StrategyCheck[] }) {
  return <ul className="text-xs space-y-2 mt-2">
    {checks.map(check => <li key={check.name}>
      <span className={check.pass === null ? "text-muted" : check.pass ? "text-ok" : "text-warn"}>
        {check.pass === null ? "未能判斷" : check.pass ? "達標" : "未達標"} · {check.name}
      </span>
      <div className="text-muted">{check.note}</div>
    </li>)}
  </ul>;
}

class ReportRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function ReportView({ symbol }: { symbol: string }) {
  const { data, isLoading, isError, error } = useQuery<StockReport>({
    queryKey: ["report", symbol],
    retry: (failures, error) => failures < 1 && (!(error instanceof ReportRequestError) || error.status >= 500 || error.status === 429),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/report?symbol=${encodeURIComponent(symbol)}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ReportRequestError(body?.error || "暫時無法取得報告", res.status);
      }
      return res.json();
    },
  });

  if (isLoading) return <div className="card p-6 text-muted">載入報告中…</div>;
  if (isError || !data) return <div className="card p-6 text-bad">{error instanceof Error ? error.message : "暫時無法取得報告，請稍後再試。"}</div>;

  const r = data;
  const newsTicker = normalizeTicker(r.quote.symbol);
  const googleNewsUrl = newsTicker ? `https://news.google.com/search?${new URLSearchParams({ q: `${newsTicker} stock when:7d`, hl: "en-US", gl: "US", ceid: "US:en" })}` : undefined;
  const up = r.quote.change !== null && r.quote.change >= 0;
  const color = tierColor(r.score.tier);

  return (
    <div>
      {r.mode === "demo" && <div className="card p-4 mb-4 text-warn">示範模式：報價、財務、估值、評級與新聞為模擬資料，不能視為真實投資依據。</div>}
      {/* 1 報價頭 */}
      <Block n={1} title="報價頭">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-xl font-bold">{r.quote.symbol}</div>
            <div className="text-muted text-sm">{r.quote.name}</div>
          </div>
          <div className="text-3xl font-bold">${r.quote.lastPrice.toFixed(2)}</div>
          <div className={r.quote.change === null ? "text-muted" : up ? "text-ok" : "text-bad"}>
            {r.quote.change === null ? "漲跌未知" : `${up ? "+" : ""}${r.quote.change.toFixed(2)}`} ({r.quote.changePct === null ? "百分比未知" : `${r.quote.changePct >= 0 ? "+" : ""}${r.quote.changePct.toFixed(2)}%`})
          </div>
          <div className="text-muted text-sm ml-auto">成交量 {r.quote.volume === null ? "未知" : r.quote.volume.toLocaleString()}</div>
        </div>
        <p className="text-xs text-muted mt-2">供應商報價時間：{r.quote.asOf ?? "未知"}；即時／延遲狀態：{r.quote.isRealTime === true ? "供應商標示即時" : r.quote.isRealTime === false ? "供應商標示非即時" : "未知"}</p>
        {r.quote.fetchedAt && <p className="text-xs text-muted mt-1">資料讀取時間：{new Date(r.quote.fetchedAt * 1000).toLocaleString()}（不是成交時間）</p>}
        {/* 數據來源標註（透明化：每項數據實際從哪裡來） */}
        {r.sources && (
          <div className="mt-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-muted whitespace-nowrap">數據來源：</span>
              {Object.entries(r.sources).map(([k, v]) => (
                <span
                  key={k}
                  className="shrink-0 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full border cursor-help"
                  style={{ color: SOURCE_COLOR[v], borderColor: `${SOURCE_COLOR[v]}55` }}
                  title={`${SOURCE_KEY_LABEL[k] || k}：${SOURCE_LABEL[v] || v}\n出處：${v === "unknown" ? "未取得資料，未用模擬值補缺" : v === "mock" ? "示範模式：lib/futu/mock.ts 生成，非真實市場資料" : SOURCE_PROVENANCE[k] || "未記錄"}`}
                >
                  {SOURCE_KEY_LABEL[k] || k}·{SOURCE_LABEL[v] || v}
                </span>
              ))}
            </div>
            {/* Fact-check 出處明細：每一行對應一個數據區塊 */}
            <details className="text-[11px] text-muted">
              <summary className="cursor-pointer hover:text-accent">📋 點此查看每個數據的詳細出處（fact-check 用）</summary>
              <ul className="mt-2 space-y-1 pl-2 border-l border-line">
                {Object.entries(r.sources).map(([k, v]) => (
                  <li key={k} className="leading-relaxed">
                    <span className="font-medium" style={{ color: SOURCE_COLOR[v] }}>
                      {SOURCE_KEY_LABEL[k] || k}
                    </span>
                    <span className="text-muted"> · </span>
                    <span>{SOURCE_LABEL[v] || v}</span>
                    <span className="text-muted"> · </span>
                    <span className="font-mono text-[10px] break-all">{v === "unknown" ? "未取得資料，未用模擬值補缺" : v === "mock" ? "示範模式：lib/futu/mock.ts 生成，非真實市場資料" : SOURCE_PROVENANCE[k] || "未記錄"}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </Block>

      {r.timing && <aside className="card p-4 mb-4 text-sm" data-testid="data-timing">
        <h2 className="font-semibold mb-2">資料時效與交易日曆</h2>
        <div className="space-y-1 text-xs text-muted">
          <p>核對日期（美東）：{r.timing.calendar.day}；今日參考安排：{r.timing.calendar.session === "closed" ? "休市" : r.timing.calendar.session === "early_close" ? "提早收市" : r.timing.calendar.session === "regular" ? "正常交易日" : "超出參考範圍"}{r.timing.calendar.close ? `，預定 ${r.timing.calendar.close} 收市` : ""}。</p>
          <p>日曆預期最新已收盤日：{r.timing.calendar.expectedLastClosedDay ?? "未知"}</p>
          <p>來源報價日期：{r.timing.quoteDate ?? "未知"}；最新日線日期：{r.timing.lastAvailableDailyDate ?? "未知"}；已收盤研究日：{r.timing.lastClosedDailyDate ?? "未知"}</p>
          <p>供應商市場狀態原文：{r.quote.marketStatus ?? "未知"}；日期差異未核實時，不產生當前入場參考價。</p>
          <p>市值更新時間仍未知；本次讀取時間及報價日期均不能代替市值更新時間，PEG 維持快照研究用途。</p>
          <p>日曆來源：<a href={r.timing.calendar.url} target="_blank" rel="noopener noreferrer" className="text-accent">{r.timing.calendar.name} {r.timing.calendar.version}</a>；涵蓋 {r.timing.calendar.start} 至 {r.timing.calendar.end}。</p>
          <p className="text-warn">{r.timing.calendar.verification}；臨時停市與交易所最新公告仍需核實。收市時間是參考安排，不保證供應商已完成更新。</p>
        </div>
      </aside>}
      <MissingDataSummary report={r} />
      <ComparabilityPanel report={r} />

      {/* 2 評分總覽 */}
      <Block n={2} title="已知項目評分與資料覆蓋">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-4xl font-bold whitespace-nowrap" style={{ color }}>
            {r.score.total ?? "未知"}
            <span className="text-base text-muted">/100</span>
          </div>
          <div className="px-3 py-1 rounded-full text-sm font-semibold" style={{ background: `${color}22`, color }}>
            {r.score.tier}
          </div>
        </div>
        <p className="text-xs text-muted mt-2">只評估已知項目，缺失不當零分。分數不是買入指令，資料覆蓋率不是準確率或獲利機率。</p>
        <p className="text-xs text-muted mt-1">計分依據：已知得分 {r.score.earnedPoints.toFixed(2)} ÷ 可用權重 {r.score.completeness.availablePoints} × 100；不同缺項的股票不宜只比較總分。</p>
        <div className="text-sm text-warn mt-2">
          評分資料覆蓋率 {r.score.completeness.percent}%（按評分權重計算；不代表資料真實度）
          {r.score.completeness.excludedPoints > 0 && <p className="text-xs mt-1">不適用權重 {r.score.completeness.excludedPoints} 已排除；覆蓋率分母為適用權重 {r.score.completeness.applicablePoints}，不是把不適用項當作缺失。</p>}
          {r.score.completeness.missing.length > 0 && <div>缺失：{r.score.completeness.missing.join("；")}。缺失項退出分母，其餘已知項目按原有權重比例換算；此為部分評估，缺項可能改變結論。</div>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {r.score.dimensions.map(d => <div key={d.dimension} className="card p-3 text-sm" data-testid={`dimension-${d.dimension}`}>
            <div className="font-semibold">{d.dimension}：{d.score === null ? "未能評估" : `${d.score}/100`}</div>
            <div className="text-muted text-xs mt-1">資料覆蓋 {d.coverage}%（可用／適用權重 {d.availablePoints}/{d.applicablePoints}；原權重 {d.max}）</div>
            {d.notApplicable.length > 0 && <div className="text-xs text-muted mt-1">不適用：{d.notApplicable.join("、")}（不當零分）</div>}
            {d.missing.length > 0 && <div className="text-xs text-warn mt-1">未確認：{d.missing.join("、")}</div>}
          </div>)}
        </div>
        <p className="text-xs text-muted mt-2">技術評分使用最新可用日線；如該日未收盤，分數仍可能變動。下方入場條件另按已收盤日線判斷。</p>
        {r.score.proxies.length > 0 && (
          <div className="text-xs text-muted mt-2">註：{r.score.proxies.join("；")}</div>
        )}
      </Block>

      {/* 3 評分細項表 */}
      <Block n={3} title="評分細項表">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-line">
              <th className="py-1">維度</th>
              <th>子項</th>
              <th className="text-right">得分</th>
            </tr>
          </thead>
          <tbody>
            {r.score.factors.map((f, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-1 text-muted">{f.dimension}</td>
                <td>{f.sub}{f.note && <p className="text-xs text-muted mt-1">{f.note}</p>}</td>
                <td className="text-right">
                  {f.applicability === "not_applicable" ? "不適用（不計分）" : (f.availableMax ?? (f.available === false ? 0 : f.max)) === 0 ? "未知" : `${+f.score.toFixed(2)} / ${+(f.availableMax ?? f.max).toFixed(2)}${f.available === false ? "（部分資料）" : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="mt-3 text-sm" data-testid="valuation-inputs">
          <summary className="cursor-pointer text-accent">估值輸入與更新時間</summary>
          <div className="text-xs text-muted mt-2 space-y-1">
            <p>市值（美元）：{r.marketCap?.value == null ? "未知" : r.marketCap.value.toLocaleString()}</p>
            <p>市值來源：{r.marketCap ? "Nasdaq summary／MarketCap" : "未取得可核對的市值來源紀錄"}</p>
            <p>市值供應商更新時間：未知；供應商更新頻率：未知。</p>
            <p>市值讀取時間：{r.marketCap ? new Date(r.marketCap.fetchedAt * 1000).toLocaleString() : "未知"}（不是供應商更新時間）</p>
            <p>讀取方式：查詢報告時按需讀取，程式不快取市值；不保證上游即時更新。</p>
            <p>估值財年期末：{r.valuation?.financialPeriodEnd ?? "未知"}</p>
            <p>年度淨利（美元）：{r.valuation?.annualNetIncomeUSD == null ? "未知" : r.valuation.annualNetIncomeUSD.toLocaleString()}</p>
            <p>年度 P/E：{r.valuation?.pe == null ? "未知／不適用" : r.valuation.pe.toFixed(2)}；歷史年度 PEG：{r.valuation?.peg == null ? "未知／不適用" : r.valuation.peg.toFixed(2)}</p>
            <p>{r.valuation?.pegMessage ?? "未取得完整可核對的歷史 PEG 輸入；不填入假設值。"}</p>
            <p>PEG 研究公式：市值 ÷ 同年度淨利 ÷ SEC 年度 EPS 增長百分點；財年不一致時不計算，亦非預期 PEG。</p>
          </div>
        </details>
        {r.financials && <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-accent">財務數值與缺失說明</summary>
          <p className="text-muted text-xs my-2">財年期末：{r.financials.periodEnd ?? (r.mode === "demo" ? "示範資料" : "未知")}。以下包括披露數值及推導值，未知項目不以零補缺。</p>
          <dl className="space-y-2">
            {FINANCIAL_FIELDS.map(([key, label, unit]) => {
              const value = r.financials?.[key];
              return <div key={key}>
                <dt className="font-medium">{label}：{typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}` : "未知／不適用"}</dt>
                {r.financials?.notes?.[key] && <dd className="text-muted text-xs">{r.financials.notes[key]}</dd>}
              </div>;
            })}
          </dl>
          {r.financials.epsEvidence && <div className="text-xs text-muted mt-3 space-y-1" data-testid="eps-evidence">
            <p>SEC 年度攤薄 EPS（美元／股）：{r.financials.epsEvidence.currentEnd}：{r.financials.epsEvidence.current}；{r.financials.epsEvidence.previousEnd}：{r.financials.epsEvidence.previous}</p>
            <p>申報：{r.financials.epsEvidence.form}；提交日期：{r.financials.epsEvidence.filed}；編號：{r.financials.epsEvidence.accession}</p>
            <a href={r.financials.epsEvidence.url} target="_blank" rel="noopener noreferrer" className="text-accent">核對 SEC 原始 EPS 資料</a>
            <p>使用同一申報的比較數字，可能包含重述或拆股調整；不代表已完成逐筆拆股核實或歷史時點回測。</p>
          </div>}
        </details>}
      </Block>

      {/* 4 研究備忘錄 */}
      <Block n={4} title="結構化研究備忘錄" fable>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div><dt className="text-muted">趨勢</dt><dd>{r.memo.trend}</dd></div>
          <div><dt className="text-muted">關鍵價位</dt><dd>{r.memo.keyLevels}</dd></div>
          <div><dt className="text-muted">動能</dt><dd>{r.memo.momentum}</dd></div>
          <div><dt className="text-muted">波動</dt><dd>{r.memo.volatility}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">失效條件（必填）</dt><dd className="text-warn">{r.memo.invalidation}</dd></div>
        </dl>
      </Block>

      {/* 5 規則追溯 */}
      <Block n={5} title="買入信號規則追溯" fable>
        {r.rules.map((rl, i) => (
          <div key={i} className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted">進場：</span>{rl.entry}</div>
            <div><span className="text-muted">出場：</span>{rl.exit}</div>
            <div><span className="text-muted">停損：</span>{rl.stop}</div>
            <div><span className="text-muted">部位：</span>{rl.size}</div>
            <div className="sm:col-span-2"><span className="text-muted">時間週期：</span>{rl.timeframe}</div>
          </div>
        ))}
      </Block>

      {/* 6 交易計畫 */}
      <Block n={6} title="交易 / 投資計畫">
        <p className="text-xs text-muted mb-2">以下為近期高低價及實際 ATR 推導的模型參考價，並非分析師目標價；未經費用及樣本外回測驗證。</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div data-testid="technical-strategy">
            <h3 className="font-semibold">技術策略：{r.strategy.technical.status}</h3>
            <p className="text-xs text-muted mt-1">評估日線：{r.strategy.technical.evaluatedBarTime === null ? "未知" : new Date(r.strategy.technical.evaluatedBarTime * 1000).toISOString().slice(0, 10)}；符合條件仍需下一交易時段重新核價。</p>
            <StrategyChecks checks={r.strategy.technical.checks} />
          </div>
          <div data-testid="fundamental-strategy">
            <h3 className="font-semibold">基本面／估值策略：{r.strategy.fundamental.status}</h3>
            <p className="text-xs text-muted mt-1">完整資料及兩部分均達 65 分，只代表通過研究門檻；仍需等待技術觸發。分析師評級、新聞及大盤缺失不直接扣除此策略分數。</p>
            <StrategyChecks checks={r.strategy.fundamental.checks} />
          </div>
        </div>
        {r.plan ? <div className="mt-4 text-sm" data-testid="reference-plan">
          <p className="font-semibold mb-2">{r.strategy.technical.status === "符合入場條件" ? "條件成立的模型入場參考" : "觀察參考價（目前未符合入場條件）"}</p>
          <div className="flex flex-wrap gap-4">
            <div><span className="text-muted">近期價格區間：</span>{r.plan.buyZone}</div>
            <div><span className="text-muted">入場參考：</span>${r.plan.entry}</div>
            <div><span className="text-muted">模型目標價：</span>${r.plan.target}</div>
            <div><span className="text-muted">模型停損點：</span>${r.plan.stop}</div>
            <div><span className="text-muted">毛風險回報：</span>{r.strategy.technical.rewardRisk?.toFixed(2)}:1</div>
          </div>
        </div> : <p className="text-sm text-warn mt-3">未產生入場參考價：必要資料不足，或價格／止損條件無效。詳見上述檢查。</p>}
        <ul className="text-xs text-warn mt-3 space-y-1">{r.strategy.caveats.map(note => <li key={note}>{note}</li>)}</ul>
      </Block>

      {/* 7 策略審查 */}
      <Block n={7} title="策略自我審查" fable>
        <ul className="text-sm">
          {r.audit.items.map((it, i) => (
            <li key={i} className="flex justify-between border-b border-line py-1 last:border-0">
              <span>{it.name} <span className="text-muted text-xs">— {it.note}</span></span>
              <span className={`shrink-0 pl-2 ${it.pass === null ? "text-muted" : it.pass ? "text-ok" : "text-bad"}`}>{it.pass === null ? "未驗證" : it.pass ? "✓" : "✗"}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 text-center font-semibold">
          審查結果：
          <span className={r.audit.verdict === "核准" ? "text-ok" : r.audit.verdict === "拒絕" ? "text-bad" : "text-warn"}>
            {r.audit.verdict}
          </span>
        </div>
      </Block>

      {/* 8 佈局策略 */}
      <Block n={8} title="短 / 中 / 長期佈局">
        <p className="text-xs text-warn mb-2">以下為一般研究框架，未按本股票驗證，亦未取得真實 60 分鐘行情；並非已成立的交易訊號。</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="card p-3"><div className="text-accent font-semibold mb-1">短期 1–4 週</div>日/60m 順勢，依買點與失效條件操作。</div>
          <div className="card p-3"><div className="text-accent font-semibold mb-1">中期 1–6 月</div>週 K 多頭排列時分批建立，目標價止盈。</div>
          <div className="card p-3"><div className="text-accent font-semibold mb-1">長期 6–18 月</div>月 K 趨勢 + 基本面評分，逢回布局。</div>
        </div>
      </Block>

      {/* 9 買入理由（圖+新聞） */}
      <Block n={9} title={r.newsStatus === "disabled" ? "買入理由區（價格圖；新聞暫停）" : "買入理由區（圖 + 新聞）"} fable>
        <p className="text-xs text-muted mb-2">圖中買點為歷史已收盤訊號，並非目前買入推薦；當前狀態請看交易／投資計畫。</p>
        <div className="mb-3"><Chart candles={r.candlesDaily} buyPoints={r.buyPoints} height={300} /></div>
        {r.newsMessage && <p className="text-sm text-muted mb-2">{r.newsMessage}</p>}
        {r.mode === "real" && r.news.length === 0 && (r.newsStatus === "unavailable" || r.newsStatus === "rate_limited") && googleNewsUrl && (
          <a href={googleNewsUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-accent mb-2">前往 Google News 查看相關新聞</a>
        )}
        {r.newsFetchedAt && <p className="text-xs text-muted mb-2">新聞讀取時間：{new Date(r.newsFetchedAt * 1000).toLocaleString()}</p>}
        {r.news.length === 0 && !r.newsMessage && <p className="text-sm text-muted">未取得真實新聞。</p>}
        <ul className="text-sm space-y-2">
          {r.news.slice(0, 3).map((n, i) => (
            <li key={i} className="border-b border-line pb-2 last:border-0">
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium break-words">{n.title}</a>
              <div className="text-muted text-xs">{n.source} · {new Date(n.time * 1000).toLocaleString()}</div>
              <div className="text-muted mt-0.5">{n.summary}</div>
            </li>
          ))}
        </ul>
      </Block>

      {/* 10 日線圖 */}
      <Block n={10} title="日線圖">
        <Chart candles={r.candlesDaily} buyPoints={[]} height={320} />
      </Block>

      {/* 11 免責 */}
      <Block n={11} title="風險免責聲明">
        <p className="text-xs text-muted">
          本報告由系統依公開數據與既定模型自動生成，<b className="text-txt">僅供參考，不構成投資建議</b>。
          評分、買點、目標價與停損皆為模型輸出，最終投資決策與風險由使用者自行承擔。
          美股即時行情授權多為個人使用，公開轉發前請確認授權範圍。
        </p>
      </Block>
    </div>
  );
}

export { ReportView };
