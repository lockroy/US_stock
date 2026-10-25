import type { StockReport } from "@/lib/types";

export function ComparabilityPanel({ report }: { report: StockReport }) {
  const evidence = report.comparability;
  if (!evidence) return null;
  const { dividends, security } = evidence;
  const versions = report.financials?.epsHistory ?? [];
  return <aside className="card p-4 mb-4 text-sm" data-testid="data-comparability">
    <h2 className="font-semibold mb-2">歷史資料可比性</h2>
    <div className="space-y-3 text-xs text-muted">
      <div data-testid="corporate-actions">
        <p className="font-medium text-text">股息與拆股</p>
        <p>{dividends.message}</p>
        <p>可讀現金股息：{dividends.events.length} 筆；未能核對列：{dividends.rejectedRows} 筆。<a href={dividends.url} target="_blank" rel="noopener noreferrer" className="text-accent">Nasdaq 股息原始來源</a></p>
        {dividends.events.length > 0 && <details className="mt-1"><summary className="cursor-pointer">查看最近五筆除淨記錄</summary>
          <ul className="space-y-1 mt-1">{dividends.events.slice(0, 5).map((event, i) => <li key={`${event.exDate}-${i}`}>除淨 {event.exDate} · 每股 {event.amount} {event.currency ?? "幣種未知"} · 支付日 {event.paymentDate ?? "未知"}</li>)}</ul>
        </details>}
        <p className="text-warn">拆股事件、價格／成交量調整口徑仍未核實；讀到股息不代表日線已作除息調整。圖表保持供應商原值，不計作含股息總回報。</p>
      </div>
      <div data-testid="financial-history">
        <p className="font-medium text-text">財報申報版本</p>
        <p>其他財務仍是最新讀取快照，未建立完整歷史可用版本，不能直接倒填到過去回測。</p>
        <p>同財年 SEC EPS 版本：{versions.length} 筆。缺少申報接受時間，以申報翌日作保守可用日期；不代表已核對當日交易時段。</p>
        {versions.length > 0 && <details className="mt-1"><summary className="cursor-pointer">查看最近五個 EPS 版本</summary>
          <ul className="space-y-2 mt-1">{versions.slice(-5).reverse().map(version => <li key={`${version.filed}-${version.accession}`}>
            {version.filed} · {version.form} · {version.accession}<br />
            {version.status === "ready" ? `本期 ${version.current}／上期 ${version.previous} USD/shares；增長 ${version.growth === null ? "不適用" : `${version.growth.toFixed(2)}%`}` : "此版本缺少唯一可比數字，保持未知"}；保守可用日 {version.usableFromDate}
          </li>)}</ul>
        </details>}
      </div>
      <div data-testid="security-basis">
        <p className="font-medium text-text">股份類別與幣種</p>
        <p>供應商原始類別：{security.type ?? "未知"}；交易所：{security.exchange ?? "未知"}。</p>
        <p>SEC EPS 單位：{security.epsCurrency ? "USD/shares（僅限已取得 EPS）" : "未知"}；其他財報幣種／金額縮放尚未獨立交叉核對，不能用 EPS 幣種推定整份財報。</p>
        <p>股份類別與 ADR／ADS 換算比率未完成獨立核對；供應商標示存託證券時，暫不直接套用發行人 EPS。IFRS 或其他幣種 EPS 不換算補缺。</p>
      </div>
      <p>以上驗證缺項另列於缺失總覽，不當零分；不代表已完成含成本或樣本外回測。</p>
    </div>
  </aside>;
}
