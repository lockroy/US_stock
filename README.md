# 即時美股分析助手

輸入一個美股代號 → 產出「評分 → 買入時機 → 買入理由（圖+新聞）→ 日線圖」的單股決策報告。

- 數據：Nasdaq 公開 API（真實即時報價 + 日線，免 key）；富途 OpenD 為後續升級路線
- 圖表：TradingView lightweight-charts
- 評分：專家 100 分模型（基本面 30 / 估值 20 / 技術 30 / 情緒宏觀 20）
- 增強：Fable 四件套（研究備忘錄 / 失效條件 / 規則追溯 / 策略審查）
- 框架：Next.js 16 + React 19

## 本地跑

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 指標單元測試
```

## 數據真實度

| 數據 | 來源 | 狀態 |
|---|---|---|
| 即時報價 | Nasdaq 公開 API | ✅ 真實 |
| 日線 K 線 | Nasdaq 公開 API | ✅ 真實（250 根 OHLCV） |
| 財務/估值/評級/新聞 | 估算（mock） | ⚠️ 待接 Finnhub |

## 部署

### 方式一：Cloudflare Workers（詳見 DEPLOY-CLOUDFLARE-WORKERS.md）

```bash
npm run cf:build    # 構建 Workers 產物
npm run cf:deploy   # 部署到 Cloudflare
```

⚠️ Workers Free 的 10ms CPU 上限無法跑真實數據（report 接口需 5.6s），
需用 Workers Paid（$5/月）或設 `REAL_DATA=false`。

### 方式二：Vercel（推薦，Hobby 免費）

推到 GitHub → Import 到 Vercel → 設定 env vars。`vercel.json` 已配置好。

## 目錄

```
app/api/*          7 條數據 routes + /api/report 聚合
lib/indicators     技術指標引擎（純函式）
lib/scoring        專家 100 分評分
lib/fable          Fable 分析增強
lib/futu          富途 client + mock 兜底
components/report  11 區塊報告視圖
```
