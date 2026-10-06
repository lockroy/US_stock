import { NextRequest, NextResponse } from "next/server";
import { getStockData, getSearchData, type DataKind } from "./data";
import { ReportError } from "./client";

export function dataErrorResponse(error: unknown) {
  if (error instanceof ReportError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "暫時無法取得資料", code: "DATA_FAIL" }, { status: 500 });
}

export async function stockDataRequest(req: NextRequest, kind: DataKind) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (symbol === null || !symbol.trim()) return NextResponse.json({ error: "缺少 symbol", code: "MISSING_SYMBOL" }, { status: 400 });
  try {
    const data = await getStockData(kind, symbol, req.nextUrl.searchParams.get("range") ?? "day");
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return dataErrorResponse(error); }
}

export async function searchDataRequest(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query?.trim()) return NextResponse.json({ error: "缺少 q 參數", code: "MISSING_Q" }, { status: 400 });
  try { return NextResponse.json(await getSearchData(query), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return dataErrorResponse(error); }
}
