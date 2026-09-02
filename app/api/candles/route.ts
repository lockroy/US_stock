import { NextRequest, NextResponse } from "next/server";
import * as mock from "@/lib/futu/mock";
import * as nasdaq from "@/lib/futu/nasdaq";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "缺少 symbol", code: "MISSING_SYMBOL" }, { status: 400 });
  const range = req.nextUrl.searchParams.get("range") || "day";
  if (range === "1D") return NextResponse.json(mock.mockIntradayCandles(symbol)); // 分時無免費源，日線降級見 /api/report
  const real = await nasdaq.fetchDaily(symbol);
  return NextResponse.json(real ?? mock.mockDailyCandles(symbol));
}
