import { ReportView } from "@/components/report/ReportView";
import Link from "next/link";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return (
    <main className="report-shell max-w-6xl mx-auto px-4 sm:px-8 py-6">
      <Link href="/" className="text-sm text-muted hover:text-txt">← 返回搜尋</Link>
      <div className="mt-3">
        <ReportView symbol={symbol} />
      </div>
    </main>
  );
}
