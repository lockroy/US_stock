# 版本記錄 (Changelog)

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
