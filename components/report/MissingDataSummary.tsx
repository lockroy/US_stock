import type { StockReport } from "@/lib/types";
import { missingDataSummary } from "@/lib/report/missing-data";

export function MissingDataSummary({ report }: { report: StockReport }) {
  const { items, notApplicable, pausedNews, pendingValidation } = missingDataSummary(report);
  const verified = report.financials?.statementChecks?.checks.filter(check => check.status === "matched") ?? [];
  const labels: Record<string, string> = { revenue: "營收", netIncome: "年度淨利", totalEquity: "股東權益", fcf: "簡化自由現金流", cashAndEquivalents: "現金及現金等價物", shortTermInvestments: "短期投資", longTermDebt: "非流動長期債務" };
  const groups = [
    { title: "未取得資料", description: "來源未接入或未返回可用資料。", items: items.filter(item => item.status === "未取得") },
    { title: "已有資料，但仍待核實", description: "時效、定義或歷史口徑尚未完成核對。", items: items.filter(item => item.status === "未確認") },
    { title: "目前不可用", description: "資料不足或衝突，相關判斷暫停。", items: items.filter(item => item.status === "不可用") },
  ];
  return <aside className="card p-4 mb-4" aria-labelledby="missing-data-heading" data-testid="missing-data-summary">
    <h2 id="missing-data-heading" className="text-base font-semibold">資料狀態與缺失總覽</h2>
    <p className="text-sm mt-2" data-testid="missing-data-count">未齊全資料：{items.length} 項</p>
    <p className="text-xs text-muted mt-1">每項資料只計一次；以下數量不是扣分，亦不是評分資料覆蓋率。</p>
    {report.mode === "demo" && <p className="text-xs text-warn mt-1">此為示範報告的欄位檢查，不代表已取得真實市場資料。</p>}
    {report.mode === "real" && verified.length > 0 && <div className="mt-3 rounded border border-line p-3" data-testid="verified-data-summary">
      <p className="text-ok font-medium">已核對財務科目：{verified.length} 項</p>
      <p className="text-xs mt-1">{verified.map(check => labels[check.key] ?? check.key).join("、")}</p>
      <p className="text-xs text-muted mt-1">上述科目與同一 SEC 申報的美元金額對齊；不代表全部財報、即時性或策略已驗證。</p>
    </div>}
    {items.length > 0 ? <details className="mt-3 text-sm" open>
      <summary className="cursor-pointer text-accent">查看缺失項目與影響</summary>
      <div data-testid="missing-data-list" className="space-y-4 mt-3">
        {groups.filter(group => group.items.length > 0).map(group => <div key={group.title}>
          <h3 className="font-medium">{group.title}：{group.items.length} 項</h3>
          <p className="text-xs text-muted mt-1">{group.description}</p>
          <ul className="mt-2 space-y-3">{group.items.map(item => <li key={item.id} data-missing-id={item.id} className="border-b border-line pb-2 last:border-0">
            <div className="font-medium">{item.group} · {item.label} <span className="text-xs text-warn">{item.status}</span></div>
            <p className="text-xs text-muted mt-1">{item.impact}</p>
          </li>)}</ul>
        </div>)}
      </div>
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
