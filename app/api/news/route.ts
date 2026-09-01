import { NextRequest, NextResponse } from "next/server";
import * as mock from "@/lib/futu/mock";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "缺少 symbol", code: "MISSING_SYMBOL" }, { status: 400 });
  return NextResponse.json(mock.mockNews(symbol));
}
