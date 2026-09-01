import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/futu/client";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ error: "缺少 q 參數", code: "MISSING_Q" }, { status: 400 });
  const results = await searchSymbols(q);
  return NextResponse.json(results);
}
