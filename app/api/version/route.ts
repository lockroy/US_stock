import { NextResponse } from "next/server";

// 部署驗收用；只回傳功能狀態，不回傳聯絡資料或任何憑證。
export function GET() {
  return NextResponse.json({
    release: "2026-10-25-real-data-v2.1",
    mode: process.env.REAL_DATA === "false" ? "demo" : "real",
    newsEnabled: process.env.NEWS_ENABLED !== "false",
    secConfigured: !!process.env.SEC_USER_AGENT?.trim()
      && /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/.test(process.env.SEC_USER_AGENT)
      && !/[\r\n]/.test(process.env.SEC_USER_AGENT),
  }, { headers: { "Cache-Control": "no-store" } });
}
