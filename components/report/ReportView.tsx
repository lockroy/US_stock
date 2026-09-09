"use client";

import { useQuery } from "@tanstack/react-query";
import { Chart } from "@/components/Chart";
import type { StockReport } from "@/lib/types";

const tierColor: Record<string, string> = {
  強烈建議買入: "#22c55e",
  建議買入: "#22c55e",
  觀望: "#f59e0b",
  避開: "#ef4444",
};

// 數據來源標籤
const SOURCE_LABEL: Record<string, string> = {
  nasdaq: "Nasdaq 真實",
  derived: "推導計算",
  mock: "模擬數據",
  proxy: "代理假設",
};
const SOURCE_COLOR: Record<string, string> = {
  nasdaq: "#22c55e",
  derived: "#58a6ff",
  mock: "#f59e0b",
  proxy: "#8b949e",
};
const SOURCE_KEY_LABEL: Record<string, string> = {
  quote: "報價",
  candlesDaily: "日線",
  candlesIntraday: "分時",
  financials: "財務",
  valuation: "估值",
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
  quote: "lib/futu/nasdaq.ts → fetchQuote()｜Nasdaq /api/quote/{t}/info",
  candlesDaily: "lib/futu/nasdaq.ts → fetchDaily()｜Nasdaq /api/quote/{t}/historical",
  candlesIntraday: "lib/futu/mock.ts → fetchIntraday()｜目前無真實源，以日線收盤價模擬",
  financials: "lib/futu/nasdaq.ts → fetchFinancials()｜Nasdaq /api/company/{t}/financials",
  valuation: "lib/futu/nasdaq.ts → buildValuation()｜市值÷財務數字推導",
  ratings: "lib/futu/mock.ts → fetchRatings()｜無免費真實源，種子隨機生成",
  news: "lib/futu/mock.ts → fetchNews()｜無免費真實源，種子隨機生成",
  marketTrendUp: "lib/futu/nasdaq.ts → fetchEtfDaily(SPY)｜Nasdaq /api/quote/SPY/historical",
  sectorStrong: "lib/futu/nasdaq.ts → fetchEtfDaily(sector ETF)｜Nasdaq /api/quote/{ETF}/historical",
  indicators: "lib/indicators/indicators.ts｜由 candlesDaily 本地計算（EMA/RSI/MACD/KD/布林/ATR/VWAP）",
  scoring: "lib/scoring/scoring.ts｜本地評分模型（基本面30+估值20+技術30+情緒20=100）",
};

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

function ReportView({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery<StockReport>({
    queryKey: ["report", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/report?symbol=${symbol}`);
      if (!res.ok) throw new Error("fetch fail");
      return res.json();
    },
  });

  if (isLoading) return <div className="card p-6 text-muted">載入報告中…</div>;
  if (isError || !data) return <div className="card p-6 text-bad">無法取得數據，請確認代號或稍後再試。</div>;

  const r = data;
  const up = r.quote.change >= 0;
  const color = tierColor[r.score.tier] || "#8b949e";

  return (
    <div>
      {/* 1 報價頭 */}
      <Block n={1} title="報價頭">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-xl font-bold">{r.quote.symbol}</div>
            <div className="text-muted text-sm">{r.quote.name}</div>
          </div>
          <div className="text-3xl font-bold">${r.quote.lastPrice.toFixed(2)}</div>
          <div className={up ? "text-ok" : "text-bad"}>
            {up ? "+" : ""}
            {r.quote.change.toFixed(2)} ({up ? "+" : ""}
            {r.quote.changePct.toFixed(2)}%)
          </div>
          <div className="text-muted text-sm ml-auto">成交量 {r.quote.volume.toLocaleString()}</div>
        </div>
        {/* 數據來源標註（透明化：每項數據實際從哪裡來） */}
        {r.sources && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted">數據來源：</span>
              {Object.entries(r.sources).map(([k, v]) => (
                <span
                  key={k}
                  className="text-[10px] px-1.5 py-0.5 rounded-full border cursor-help"
                  style={{ color: SOURCE_COLOR[v], borderColor: `${SOURCE_COLOR[v]}55` }}
                  title={`${SOURCE_KEY_LABEL[k] || k}：${SOURCE_LABEL[v] || v}\n出處：${SOURCE_PROVENANCE[k] || "未記錄"}`}
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
                    <span className="font-mono text-[10px]">{SOURCE_PROVENANCE[k] || "未記錄"}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </Block>

      {/* 2 評分總覽 */}
      <Block n={2} title="評分總覽 + 評級">
        <div className="flex items-center gap-4">
          <div className="text-4xl font-bold" style={{ color }}>
            {r.score.total}
            <span className="text-base text-muted">/100</span>
          </div>
          <div className="px-3 py-1 rounded-full text-sm font-semibold" style={{ background: `${color}22`, color }}>
            {r.score.tier}
          </div>
        </div>
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
                <td>{f.sub}</td>
                <td className="text-right">
                  {f.score} / {f.max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <div className="flex flex-wrap gap-4 text-sm">
          <div><span className="text-muted">買入區間：</span>{r.plan.buyZone}</div>
          <div><span className="text-muted">目標價：</span><span className="text-ok">${r.plan.target}</span></div>
          <div><span className="text-muted">停損點：</span><span className="text-bad">${r.plan.stop}</span></div>
        </div>
      </Block>

      {/* 7 策略審查 */}
      <Block n={7} title="策略自我審查" fable>
        <ul className="text-sm">
          {r.audit.items.map((it, i) => (
            <li key={i} className="flex justify-between border-b border-line py-1 last:border-0">
              <span>{it.name} <span className="text-muted text-xs">— {it.note}</span></span>
              <span className={it.pass ? "text-ok" : "text-bad"}>{it.pass ? "✓" : "✗"}</span>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="card p-3"><div className="text-accent font-semibold mb-1">短期 1–4 週</div>日/60m 順勢，依買點與失效條件操作。</div>
          <div className="card p-3"><div className="text-accent font-semibold mb-1">中期 1–6 月</div>週 K 多頭排列時分批建立，目標價止盈。</div>
          <div className="card p-3"><div className="text-accent font-semibold mb-1">長期 6–18 月</div>月 K 趨勢 + 基本面評分，逢回布局。</div>
        </div>
      </Block>

      {/* 9 買入理由（圖+新聞） */}
      <Block n={9} title="買入理由區（圖 + 新聞）" fable>
        <div className="mb-3"><Chart candles={r.candlesDaily} buyPoints={r.buyPoints} height={300} /></div>
        <ul className="text-sm space-y-2">
          {r.news.slice(0, 3).map((n, i) => (
            <li key={i} className="border-b border-line pb-2 last:border-0">
              <a href={n.url} className="font-medium">{n.title}</a>
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
