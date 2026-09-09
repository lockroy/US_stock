# 版本記錄 (Changelog)

## v0.6.1 — 2026-09-08（UI 升級：fact-check 數據溯源）

**狀態**：✅ 純前端改動，無後端變更

**核心變更**——把 v0.6.0 已有的「來源標籤」升級為可 fact-check 的「源頭出處明細」：

1. **新增 `SOURCE_PROVENANCE` 常數**：11 個 key 對應每個數據區塊的具體源頭（檔案路徑 + 函式 + 端點）
2. **標籤 hover tooltip 增強**：彩色標籤滑鼠移上去顯示完整出處（例：`lib/futu/nasdaq.ts → fetchQuote()｜Nasdaq /api/quote/AAPL/info`）
3. **新增可展開明細區塊**：報價頭下方加一個 `<details>`，預設展開，列出 11 項數據各自的 `名稱 · 類型 · 源頭路徑`
4. **純前端改動**：只動 `components/report/ReportView.tsx`（+23 行），不影響後端 API、不改 types 結構、不破壞既有配色（綠=Nasdaq 真實 / 藍=推導 / 黃=模擬 / 灰=代理）

**使用者價值**：使用者可一目了然知道每個數據從哪個 API/函式來，方便逐項 fact-check（例如：股價 → Nasdaq /api/quote/{t}/info、圖表 → Nasdaq /api/quote/{t}/historical、新聞 → 目前為 mock）

---

## v0.6.0 — 2026-09-01（數據層升級：接入真實數據）

**狀態**：✅ 端到端驗證通過（AAPL 81 分 / NVDA 88 分，真實數據全鏈路）

**核心變更**——從全 mock 升級為「Nasdaq 真實數據優先 + mock 兜底」：

1. **財務七項接真實**：Nasdaq 年報四表（損益/資債/現金流/財務比率）推導營收增長、EPS 增長、毛利率、ROE、ROIC、負債權益比、自由現金流
2. **估值六項接推導**：市值（Nasdaq summary）+ 財務數字 → P/E、PEG、P/B、P/S、FCF 收益率、EV/Sales
3. **大盤/產業代理接真實**：SPY ETF 日線判多空（現價 vs SMA50）；產業 ETF 與 SPY 近 20 日報酬比較相對強弱（Technology→XLK 等 11 產業映射）
4. **來源透明化**：API 回應新增 `sources` 欄位，報告頁「報價頭」下方顯示彩色來源標籤（綠=Nasdaq 真實、藍=推導、黃=模擬、灰=代理）
5. **單項路由同步**：`/api/quote`、`/api/candles`、`/api/financials`、`/api/valuation` 全部改為真實數據優先
6. **日線拉取修正**：260→400 日曆天（276 個交易日），修復 EMA200 數據不足（AAPL 技術面 5/10→10/10 即為此修正效果）
7. **並行拉取**：第一波 5 個請求 Promise.all 並行，每請求 8-10 秒逾時，失敗逐項降級 mock
8. **`REAL_DATA` 改回 `true`**：真實數據模式上線。若 Workers Free 10ms CPU 限制導致 Error 1102，改回 `"false"` 即可降級
9. **新增 `DATA-SOURCES.md`**：完整數據來源說明（架構圖、推導公式、限制、升級路徑）

**仍為模擬的數據**：分析師評級、個股新聞（無穩定免費源，建議下一步註冊 Finnhub 免費 key 補齊）、日內分時（日線降級顯示）

**驗證**：✅ npm test 全過 ｜ ✅ next build 成功 ｜ ✅ 端到端 AAPL/NVDA 真實數據報告生成

---

## v0.5.1 — 2026-09-01（修復 v0.5.0 的 lock 檔案損壞）

**狀態**：✅ 已修復並三重驗證（npm ci / cf:build / zip 內終極驗證）

**v0.5.0 的缺陷（本次修復）**：
- v0.5.0 打包時用 `sed` 全局替換版本號，誤傷了 lock 檔案中恰好是 0.4.0 版本的依賴包（`asynckit`、`@cloudflare/kv-asset-handler`），導致 `npm ci` 報「Missing: asynckit@0.4.0」
- 本版用 `npm install` 重新生成乾淨 lock，版本號改用 npm 官方命令 `npm version` 更新

**修復後驗證**：
- ✅ `npm ci`（部署平台同款命令）通過
- ✅ `npm run cf:build` 生成 worker.js 成功
- ✅ 從 zip 解出檔案再跑 `npm ci --dry-run` 通過（終極保險）

**含 v0.5.0 的全部修復**：Worker 名稱 `us-stock`、REAL_DATA=false

---

## v0.5.0 — 2026-09-01（修復 Worker 名稱不匹配）⚠️ 有 lock 損壞缺陷，請用 v0.5.1

**狀態**：✅ build 成功、部署配置修正（最後一步）

**變更**：
- 修復 `wrangler.jsonc` 的 Worker 名稱不匹配：
  - `name` 從 `us-stock-analyzer` → `us-stock`（與 Cloudflare 上的 Worker 名稱一致）
  - `WORKER_SELF_REFERENCE` 的 `service` 同步改為 `us-stock`
  - 根因：Cloudflare 上的 Worker 叫 `us-stock`，但配置寫 `us-stock-analyzer`，導致 service binding 找不到目標（error 10143）
- `REAL_DATA` 改為 `false`（Free 方案先跑通流程，避免 CPU 超時）

**部署後驗證**：build 階段已確認成功（`Worker saved in .open-next/worker.js`），此版應可完整部署。

---

## v0.4.0 — 2026-09-01（修復部署命令）

**狀態**：⚠️ 修復部署階段的 build 命令問題

**變更**：
- 將 `build` script 從 `next build` 改為 `opennextjs-cloudflare build`
  - **根因**：部署平台用 `npm run build`（= next build）只做普通 Next 構建，不會生成 OpenNext 產物（`.open-next/`），導致 `wrangler deploy` 報「Could not find compiled Open Next config」
  - `opennextjs-cloudflare build` 會先跑 next build，再生成 OpenNext 產物

**部署平台需確認**：build 命令務必是 `npm run build`（現在會自動生成 OpenNext 產物），deploy 命令用 `npx wrangler deploy` 即可。

---

## v0.3.0 — 2026-09-01（完整可運行，修復依賴同步）

**狀態**：✅ 端到端驗證通過（乾淨安裝 → 測試 → 構建 → OpenNext 打包 → 真實數據運行）

**變更**：
- 修復 `package-lock.json` 與 `package.json` 不同步問題（`npm ci` 報 EUSAGE 的根因）
- 升級 `@tanstack/react-query` 5.51.1 → 5.102.8（支援 React 19，修復 peer 依賴衝突）
- 完整驗證：`npm ci` 通過、`next build` 通過、單元測試通過、`cf:build` 生成 worker.js
- 實測真實數據：AAPL $316.85、75分、178 根真實 K 線

**已知限制**：Workers Free 的 10ms CPU 上限會讓 `/api/report` 超時，需設 `REAL_DATA=false` 或升 Workers Paid。

---

## v0.2.0 — 2026-09-01（升級 Next 16，但有缺陷）

**狀態**：⚠️ 構建失敗（兩個問題）

**變更**：
- 升級 Next.js 14.2.5 → 16.3.4，React 18 → 19
- 加入 `@opennextjs/cloudflare` + `wrangler` 適配器
- 新增 `wrangler.jsonc`、`open-next.config.ts` 等 Cloudflare 部署配置
- 修復 Next 16 的 `params` 異步變更、`Candle` 類型導出

**缺陷**：
- `@tanstack/react-query@5.51.1` 與 React 19 衝突（peer 依賴 ERESOLVE）
- `package-lock.json` 未同步（`npm ci` 報 EUSAGE）

---

## v0.1.0 — 2026-08-31（原始 MVP）

**狀態**：✅ 可運行（Next 14 + Vercel）

**內容**：
- 初始版本：Next.js 14.2.5 + React 18
- 5 步決策流（輸入代號 → 評分 → 買入時機 → 買入理由 → 日線圖）
- 專家 100 分評分模型 + Fable 四件套
- 數據源：Nasdaq 公開 API（真實報價 + 日線）+ mock 兜底
- 部署：Vercel（vercel.json）
