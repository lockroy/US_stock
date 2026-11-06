import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: "美股研究助手",
  description: "以財務、估值與日線研究美股，清楚呈現資料來源、缺項與策略條件",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <a href="#main-content" className="skip-link">跳到主要內容</a>
        <header className="site-header px-5 sm:px-8 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <Link href="/" className="brand flex items-center gap-3"><span className="brand-mark" aria-hidden="true">↗</span><span className="text-sm font-semibold tracking-wide">美股分析助手<span className="block text-[10px] text-muted tracking-[0.18em] mt-0.5">STOCK RESEARCH</span></span></Link>
            <span className="rounded-full border border-accent bg-accent/10 px-3 py-1 text-sm font-bold text-accent whitespace-nowrap" data-testid="app-version">版本 V{APP_VERSION}</span>
          </div>
        </header>
        <div id="main-content"><Providers>{children}</Providers></div>
        <footer className="mx-auto max-w-6xl px-5 sm:px-8 py-6 text-xs text-muted border-t border-line flex flex-wrap justify-between gap-3"><span>美股研究助手 · 讓每個判斷有據可查</span><span>公開資料 · 模型研究 · 自主決策</span></footer>
      </body>
    </html>
  );
}
