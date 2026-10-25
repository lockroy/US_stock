import type { StockReport } from "@/lib/types";

export function ComparabilityPanel({ report }: { report: StockReport }) {
  const evidence = report.comparability;
  if (!evidence) return null;
  const { dividends, security } = evidence;
  const versions = report.financials?.epsHistory ?? [];
  const checks = report.financials?.statementChecks;
  const labels = { revenue: "營收", netIncome: "年度淨利", totalEquity: "股東權益", fcf: "簡化自由現金流" };
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
        <p>SEC EPS 單位：{security.epsCurrency ? "USD/shares（僅限已取得 EPS）" : "未知"}；不能用 EPS 幣種推定整份財報，其他財報幣種／金額縮放按下列科目逐項核對。</p>
        <p>股份類別與 ADR／ADS 換算比率未完成獨立核對；供應商標示存託證券時，暫不直接套用發行人 EPS。IFRS 或其他幣種 EPS 不換算補缺。</p>
      </div>
      <div data-testid="statement-checks">
        <p className="font-medium text-text">財報金額與單位交叉核對</p>
        {checks ? <>
          <p>同財年 {checks.periodEnd} · SEC 申報 {checks.filed} · {checks.accession}。<a href={checks.url} target="_blank" rel="noopener noreferrer" className="text-accent">SEC 原始科目來源</a></p>
          <ul className="space-y-2 mt-1">{checks.checks.map(check => <li key={check.key} data-statement-key={check.key}>
            <span className={check.status === "matched" ? "text-ok" : "text-warn"}>{labels[check.key]}：{check.status === "matched" ? "金額／USD 單位對齊" : check.status === "mismatch" ? "有差異，待核對" : "未取得可比資料"}</span>
            <p>Nasdaq 原值 {check.providerThousands?.toLocaleString() ?? "未知"} × 1000；SEC {check.secUSD?.toLocaleString() ?? "未知"} USD；差額 {check.differenceUSD?.toLocaleString() ?? "未知"} USD。</p>
            <details><summary className="cursor-pointer">科目與核對限制</summary><p className="break-words">{check.metrics.join("、") || "未取得科目"}。{check.note}</p></details>
          </li>)}</ul>
        </> : <p>未取得同一 SEC 申報的可比財務科目，幣種及金額縮放保持未核實，不以 EPS 單位代替。</p>}
        <p>只核對列出科目，未涵蓋全部財報、債務、現金、股份或匯率口徑。有差異時暫停依賴該金額的估值，原始數字保留供查核；來源缺失不當零分。</p>
      </div>
      <p>以上驗證缺項另列於缺失總覽，不當零分；不代表已完成含成本或樣本外回測。</p>
    </div>
  </aside>;
}
