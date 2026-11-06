import { SearchBox } from "@/components/SearchBox";

export default function Home() {
  return (
    <main className="home-shell mx-auto max-w-6xl px-5 sm:px-8">
      <section className="home-hero">
        <div className="eyebrow"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> 美股研究工作台</div>
        <h1 className="mt-6 text-4xl sm:text-6xl font-semibold tracking-tight leading-tight">從一隻股票，<br /><span className="text-accent">看清下一步。</span></h1>
        <p className="mt-5 max-w-lg text-muted leading-7">把財務、估值與價格訊號放在一起。先看資料是否齊全，再判斷買入條件。</p>
        <div className="search-panel mt-9">
          <label htmlFor="stock-search" className="block text-sm font-medium mb-3">開始研究</label>
          <SearchBox />
          <p className="mt-3 text-xs text-muted">支援美股代號或英文公司名稱 · 選擇股票後才讀取報告</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted"><span>Nasdaq 行情與財務</span><span>SEC 原始申報</span><span>來源與缺項可追溯</span></div>
      </section>
      <section aria-labelledby="workflow-heading" className="pb-12">
        <div className="flex items-center justify-between mb-5 border-t border-line pt-7"><h2 id="workflow-heading" className="text-sm font-medium">一份報告，三個研究重點</h2><span className="text-xs text-muted hidden sm:block">資料 → 判斷 → 核對</span></div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            ["01", "了解公司", "財務與估值", "看清已知項目的評分與資料覆蓋，缺失不當零分。"],
            ["02", "觀察時機", "趨勢與入場條件", "結合已收盤日線與技術條件，區分歷史訊號及當前狀態。"],
            ["03", "核對依據", "來源與風險", "逐項查看來源、資料時效與未核實內容，再作判斷。"],
          ].map(([number, title, subtitle, text]) => <article key={number} className="card feature-card p-6">
            <div className="flex justify-between items-center"><span className="eyebrow">{subtitle}</span><span className="text-muted text-xs font-mono">{number}</span></div>
            <h3 className="text-xl font-semibold mt-5 mb-3">{title}</h3><p className="text-sm text-muted leading-6">{text}</p>
          </article>)}
        </div>
        <p className="mt-7 text-xs text-muted leading-6 max-w-3xl">真實模式不以模擬資料補缺；示範模式會明確標記。行情時效以報告內來源時間為準，新聞目前暫停。評分與買點屬模型研究，並非投資建議。</p>
      </section>
    </main>
  );
}
