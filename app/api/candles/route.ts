import { NextRequest, NextResponse } from "next/server";
import * as mock from "@/lib/futu/mock";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const range = req.nextUrl.searchParams.get("range") || "day";
  if (!symbol) return NextResponse.json({ error: "缺少 symbol", code: "MISSING_SYMBOL" }, { status: 400 });
  const candles = range === "1D" ? mock.mockIntradayCandles(symbol) : mock.mockDailyCandles(symbol);
  return NextResponse.json(candles);
}
