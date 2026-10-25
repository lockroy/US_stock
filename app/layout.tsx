import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: "即時美股分析助手",
  description: "輸入美股代號，產出評分 → 買入時機 → 買入理由 → 日線圖 的決策報告",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <header className="border-b border-line px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold">美股分析助手</Link>
            <span className="rounded-full border border-accent bg-accent/10 px-3 py-1 text-sm font-bold text-accent whitespace-nowrap" data-testid="app-version">版本 V{APP_VERSION}</span>
          </div>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
