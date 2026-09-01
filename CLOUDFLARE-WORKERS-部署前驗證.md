# 部署前完整流程模擬與 Cloudflare Workers 相容性驗證

> 目標：把「即時美股分析助手」部署到 **Cloudflare Workers**
> 驗證日期：2026-09-01
> 現況版本：Next.js **14.2.5** + App Router + Route Handlers

---

## 0. 一句話結論（先講重點）

**以「現有程式碼原樣部署到 Cloudflare Workers」目前行不通**，有三個硬阻斷點：

| # | 阻斷點 | 嚴重度 | 一句話 |
|---|---|---|---|
| 1 | Next.js 14 已於 Q1 2026 終止支援，OpenNext 官方不再支援 14 | 🔴 致命 | 適配器層就過不了 |
| 2 | Workers Free CPU 上限 **10ms/request**，你的 report 要 5.6 秒 | 🔴 致命 | Free 版一定爆 |
| 3 | Workers 同時外連 6 條、subrequest 50 條限制 + 128MB 記憶體 | 🟡 高 | 需重構並發模型 |

**可行路徑只有兩條**（見 §7）：
- **路徑 A（建議）**：升級 Next.js 14 → 15/16 + 加 `@opennextjs/cloudflare` 適配器 + 至少 Workers Paid（$5/月）
- **路徑 B（最省事）**：改走 **Cloudflare Pages**（`@cloudflare/next-on-pages`），或乾脆維持 Vercel

---

## 1. 完整流程模擬（輸入 → 處理 → 輸出 → 相依）

### 1.1 端到端主流程

```
[使用者] 輸入代號 "AAPL"
   │
   ▼
① 首頁 / (SearchBox)           前端組件，client 端
   輸入：字串 q="AAPL"
   處理：onChange 觸發 fetchSuggest(q) → GET /api/search?q=AAPL
   輸出：下拉建議清單 [{symbol:"US.AAPL", name:"Apple Inc.", ...}]
   相依：/api/search 有結果才顯示建議
   │
   ▼ 使用者點選 or 按 Enter
② 路由跳轉 router.push("/stock/AAPL")
   │
   ▼
③ 報告頁 /stock/[symbol]  (ReportView)   前端組件，client 端
   輸入：URL 參數 symbol="AAPL"
   處理：useQuery → fetch("/api/report?symbol=AAPL")
   輸出：渲染 11 個區塊（報價/評分/備忘錄/規則/計畫/審查/佈局/買入理由/日線圖/免責）
   相依：/api/report 回傳完整 StockReport JSON
   │
   ▼
④ API /api/report  (Route Handler)    ← 全流程核心，server 端
   輸入：symbol=AAPL
   處理：buildReport("AAPL")（見 §1.2 內部 6 步）
   輸出：StockReport JSON（約 8 個欄位，含 250 根 K 線）
   相依：Nasdaq API 可達、指標計算、評分模型
```

### 1.2 buildReport 內部 6 步（server 端串行）

| 步 | 動作 | 資料源 | 成功回傳 | 失敗兜底 | 相依 |
|---|---|---|---|---|---|
| 1 | 日線 K | `nasdaq.fetchDaily`（260 根） | 真實 OHLCV | 富途 → mock | Nasdaq 可達 |
| 2 | 即時報價 | `nasdaq.fetchQuote` | 真實價 | 富途 → mock | Nasdaq 可達 |
| 3 | 日內分時 | `futuGet`（骨架回 null） | 無 | 日線降級 | 無（永遠降級） |
| 4 | 財務/估值/評級/新聞 | `futuGet`（回 null） | 無 | **全 mock 估算** | 富途憑證（未接） |
| 5 | 技術指標 | `computeIndicators(daily)` | EMA/RSI/MACD/KD/布林/ATR/VWAP | — | 純 CPU 計算 |
| 6 | 評分+備忘錄 | `score` + `buildMemo` + `audit` + `findBuyPoints` | 100 分制 | — | 純 CPU 計算 |

### 1.3 完整相依關係圖

```
/search ──(真實 Nasdaq info)──→ nasdaq.fetchQuote
    │
    ▼
/stock/[symbol] ──→ /api/report ──→ buildReport
                                      │
                                      ├─ fetchDaily ──→ api.nasdaq.com  (網路, 10s timeout)
                                      ├─ fetchQuote ──→ api.nasdaq.com  (網路, 8s timeout)
                                      ├─ computeIndicators ──→ 250 根 K 線 (CPU)
                                      └─ score/audit/fable ──→ 純計算 (CPU)
```

**關鍵發現**：前端只依賴 `/api/report` 與 `/api/search` 這兩個「真實」端點；其餘 6 個 API（quote/candles/financials/valuation/ratings/news）**全部是 mock 死程式碼**，前端根本沒呼叫它們（ReportView 只 fetch `/api/report`）。

---

## 2. Cloudflare Workers 環境相容性逐項檢查

### 2.1 環境變數

| 變數 | 用途 | Workers 支援 | 狀態 |
|---|---|---|---|
| `REAL_DATA` | 真實/mock 開關 | ✅ 走 `wrangler` vars | 需設，預設 true |
| `FUTU_CLIENT_ID` / `SECRET` | 富途 OAuth | ✅ 但需用 **secrets** 加密 | 目前空（未接） |
| `FUTU_API_BASE` | 富途 endpoint | ✅ | 目前無效（需 OpenD 閘道） |
| `NEWS_API_KEY` | 新聞兜底 | ✅ | 未實作 |

**注意**：Workers 的環境變數用 `wrangler.toml` / `wrangler.jsonc` 的 `[vars]` 或 `[[d1_databases]]` 綁定，**不是** `.env` 檔。敏感值要走 `wrangler secret put`。

### 2.2 API 介接（核心風險）

| 介接 | 位置 | Workers 是否相容 |
|---|---|---|
| `api.nasdaq.com`（外部 fetch） | `lib/futu/nasdaq.ts` | ⚠️ **同時外連限制 6 條**，且 Nasdaq 是第三方，需靠 Workers 的 `fetch`（已相容 Web Fetch API） |
| `AbortSignal.timeout(8000)` | nasdaq.ts | ✅ Workers 支援 AbortSignal（需 Node 16.5+ 相容） |
| 富途 OpenD 閘道 | 未接 | 🔴 **Workers 無法跑常駐閘道**（無狀態、無長駐進程），富途這條路在 Workers 上基本封死 |

### 2.3 執行限制（致命）

| 限制 | Free | Paid | 你的實際需求 | 判定 |
|---|---|---|---|---|
| CPU 時間 | **10 ms** | 30s（可調 5 分鐘） | report 實測 5.6s | 🔴 Free 必爆 |
| 記憶體 | 128 MB | 128 MB | Next SSR + 250 根 K 線計算 | 🟡 需壓測 |
| 同時外連 | 6 條 | 6 條 | 串行 fetch，實際 2-3 條 | 🟢 可 |
| subrequest | 50 | 10000 | 每次 report 2 個外部呼叫 | 🟢 可 |
| Worker 大小 | 3 MB | 10 MB | Next 打包 + lightweight-charts | 🟡 需看 gzip 後 |
| 冷啟動 | 極低 | 極低 | — | 🟢 |

> **決定性事實**：你的 `/api/report` 在本地實測 **5.6 秒**（含 Nasdaq 兩個 8s/10s timeout 的網路等待）。**Workers Free 的 10ms CPU 上限，連一個指標函式都跑不完**。就算 Workers Paid 預設 30s，把 CPU 調到 5 分鐘也才勉強，但成本與複雜度都上去了。

---

## 3. 框架相容性（OpenNext 適配器）

你的專案是 **Next.js 14.2.5**。查證結果（官方 OpenNext 文件，2026-09）：

> **「Next.js 14 support will be dropped Q1 2026. It is no more supported by the Next.js team.」**

**翻譯成白話**：
- OpenNext 目前只支援 **Next.js 16**（全版本）與 **15 / 14 的最新 minor**。
- 你的 14.2.5 已經「不再支援」，即便勉強用 `@opennextjs/cloudflare` 適配器，也可能出現未定義行為、build 失敗或 runtime 崩潰。

**且你的 App Router + Route Handlers** 是 OpenNext 支援的功能（App Router ✅ / Route Handlers ✅ / 動態路由 ✅ / SSR ✅），**理論上**可轉，但前提是先升級 Next.js 版本。

---

## 4. 流程中會出錯或需調整的地方（清單）

| # | 位置 | 問題 | 影響 | 建議 |
|---|---|---|---|---|
| 1 | 全專案 | **Next.js 14 已終止支援** | 適配器無法保證 | 升級到 15/16 |
| 2 | `/api/report` | **CPU 10ms（Free）or 30s（Paid）限制** | Free 必爆 | 至少 Paid + 調 CPU，或降級計算 |
| 3 | `nasdaq.ts` | 兩個 `AbortSignal.timeout`（8s/10s）串行等待 | 每次 report 最壞等 18s | 併發化、縮短 timeout、加 KV 快取 |
| 4 | `nasdaq.ts` | 無快取，每個請求都重打 Nasdaq | 高頻觸發 Nasdaq 限流/封鎖 | 加 Cloudflare KV 快取（如 5 分鐘） |
| 5 | 富途骨架 | `futuGet` 依賴常駐 OpenD 閘道 | Workers 無常駐進程 | 放棄富途，改接免閘道資料源（如 Finnhub/Polygon） |
| 6 | 財務/估值/新聞 | **全是 mock 估算**，非真實數據 | 評分模型建立在假數據上 | 接 Finnhub（免費 tier 有基本面+新聞） |
| 7 | `/api/quote` 等 6 端點 | **死程式碼**（前端沒呼叫） | 混淆、多餘打包體積 | 刪除或標註，減小 Worker 體積 |
| 8 | `page.tsx` 底部文案 | 仍寫「無憑證 demo / mock 數據」 | 與實際不符 | 改成真實來源說明 |
| 9 | `vercel.json` | 專為 Vercel 寫的配置 | 對 Workers 無效 | 改 `wrangler.jsonc` |
| 10 | 環境變數 | `.env` 在 Workers 不生效 | 配置失效 | 改 `wrangler` vars/secret |
| 11 | `marketTrendUp` / `sectorStrong` | 寫死 `true`（代理值） | 評分偏差 | 接大盤/產業數據或標註 |

---

## 5. 各步驟的 Cloudflare 專屬注意事項

1. **Route Handler → Workers fetch handler**：OpenNext 會把你的 `app/api/*/route.ts` 轉成 Worker 的 `fetch` 入口。每條 route 都是同一個 Worker 的內部路由，**不是**獨立函式。
2. **動態路由 `/stock/[symbol]`**：需確保 `dynamic = 'force-dynamic'`（SSR），否則 build 時會嘗試靜態生成，而 Nasdaq API 在 build 環境不可用。
3. **lightweight-charts**：純 client 端 lib，`Chart.tsx` 已標 `"use client"`，Workers SSR 不會執行它，**無相容問題**（但要留意 gzip 體積）。
4. **TanStack Query**：client 端，無問題。
5. **快取策略**：Workers 沒有內建 ISR，需自己用 KV / Cache API 做資料快取，否則每次刷新都重打 Nasdaq。

---

## 6. 建議的部署前「正確順序」（若要堅持 Workers）

```
1. 升級 Next.js 14.2.5 → 15.x（或 16）
2. 安裝 @opennextjs/cloudflare 適配器
3. 加 wrangler.jsonc（vars、cpu_ms、kv binding）
4. /api/report 內：併發 fetch + KV 快取 + 縮短 timeout
5. 接 Finnhub/Polygon 取代富途（拿真財務/新聞）
6. 刪除 6 個死 route，減體積
7. 至少開 Workers Paid（$5/月），CPU 設 30s+
8. 本地 wrangler dev 驗證 → wrangler deploy
```

---

## 7. 我的建議（誠實評估）

**Workers 不是這個專案的最佳落點**，原因：

1. 你的核心價值是「即時報價 + 250 根 K 線指標 + 評分」，這是 **CPU 偏重 + 依賴外部 API 的 server 端工作負載**，恰好是 Workers「輕量邊緣、10ms/短 CPU」設計的反面。
2. Next.js 官方第一方支援在 **Vercel**（你的 `vercel.json` 都寫好了），Vercel Functions 預設 CPU 遠寬鬆、無需適配器、ISR 零配置。
3. Workers 的「$5/月」其實跟 Vercel Hobby（免費）比，反而不划算。

**我的具體建議排序**：

| 優先 | 方案 | 理由 |
|---|---|---|
| ⭐ 首選 | **Vercel**（原計劃） | 第一方支援、vercel.json 已寫好、Hobby 免費可跑、零適配器 |
| 🥈 次選 | **Cloudflare Pages**（next-on-pages） | 比 Workers 更適合 Next，`@cloudflare/next-on-pages` 專門做這個 |
| 🥉 可接受 | **Workers + OpenNext**（需升級 Next 15/16 + Paid） | 只有當你確定要 CF 全家桶、且願意承擔升級+$5/月 |
| ❌ 不建議 | 原樣丟 Workers | 三個致命阻斷點，必失敗 |

---

## 8. 需要你決定的下一步

請回覆一個選擇：

- **A**：改回 Vercel（我照原 vercel.json 帶你部署）
- **B**：改用 Cloudflare Pages（next-on-pages 適配器）
- **C**：堅持 Workers，我幫你走「升級 Next 15/16 + OpenNext + Paid」這條路
- **D**：先別部署，先把「財務/估值/新聞」接真實源（Finnhub）再說

---

*本報告基於 2026-09-01 實讀程式碼 + 官方文件查證，非憑記憶。*
