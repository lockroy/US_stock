import type { StockReport } from "@/lib/types";
import { missingDataSummary } from "@/lib/report/missing-data";

export function MissingDataSummary({ report }: { report: StockReport }) {
  const { items, notApplicable, pausedNews, pendingValidation } = missingDataSummary(report);
  return <aside className="card p-4 mb-4" aria-labelledby="missing-data-heading" data-testid="missing-data-summary">
    <h2 id="missing-data-heading" className="text-base font-semibold">資料缺失總覽</h2>
    <p className="text-sm mt-2" data-testid="missing-data-count">未齊全資料：{items.length} 項</p>
    <p className="text-xs text-muted mt-1">每項資料只計一次；以下數量不是扣分，亦不是評分資料覆蓋率。</p>
    {report.mode === "demo" && <p className="text-xs text-warn mt-1">此為示範報告的欄位檢查，不代表已取得真實市場資料。</p>}
    {items.length > 0 ? <details className="mt-3 text-sm" open>
      <summary className="cursor-pointer text-accent">查看缺失項目與影響</summary>
      <ul className="mt-2 space-y-3" data-testid="missing-data-list">
        {items.map(item => <li key={item.id} data-missing-id={item.id} className="border-b border-line pb-2 last:border-0">
          <div className="font-medium">{item.group} · {item.label} <span className="text-xs text-warn">{item.status}</span></div>
          <p className="text-xs text-muted mt-1">{item.impact}</p>
        </li>)}
      </ul>
    </details> : <p className="text-sm text-muted mt-2">目前報告檢查範圍內沒有資料缺項；不代表供應商資料已獨立核實。</p>}
    {notApplicable.length > 0 && <div className="text-sm mt-3" data-testid="not-applicable-data">
      <p>不適用資料：{notApplicable.length} 項（不計入缺項總數，亦不當零分）</p>
      <ul className="text-xs text-muted mt-1 space-y-1">{notApplicable.map(item => <li key={item.id}>{item.label}：{item.impact}</li>)}</ul>
    </div>}
    {pausedNews && <p className="text-xs text-muted mt-3">新聞：已暫停，另列顯示，不計入上述缺項總數。</p>}
    {pendingValidation.length > 0 && <details className="text-xs mt-3">
      <summary className="cursor-pointer text-warn">策略驗證待完成：{pendingValidation.length} 項（不計入資料缺項）</summary>
      <ul className="text-muted mt-2 space-y-1">{pendingValidation.map(item => <li key={item.name}>{item.name}：{item.note}</li>)}</ul>
    </details>}
  </aside>;
}
