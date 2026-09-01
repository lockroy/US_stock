import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/futu/client";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "缺少 symbol 參數", code: "MISSING_SYMBOL" }, { status: 400 });
  try {
    const report = await buildReport(symbol);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: "組裝報告失敗", code: "BUILD_FAIL", detail: String(e) }, { status: 500 });
  }
}
