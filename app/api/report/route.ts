import { NextRequest, NextResponse } from "next/server";
import { buildReport, ReportError } from "@/lib/futu/client";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol?.trim()) return NextResponse.json({ error: "缺少 symbol 參數", code: "MISSING_SYMBOL" }, { status: 400 });
  try {
    const report = await buildReport(symbol);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "組裝報告失敗", code: "BUILD_FAIL" }, { status: 500 });
  }
}
