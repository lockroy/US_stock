import { NextRequest, NextResponse } from "next/server";
import * as mock from "@/lib/futu/mock";
import * as nasdaq from "@/lib/futu/nasdaq";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "缺少 symbol", code: "MISSING_SYMBOL" }, { status: 400 });
  const real = await nasdaq.fetchFinancials(symbol);
  return NextResponse.json(real?.fin ?? mock.mockFinancials(symbol));
}
