# 即時美股分析助手

輸入一個美股代號 → 產出「評分 → 買入時機 → 買入理由（圖+新聞）→ 日線圖」的單股決策報告。

- 數據：Nasdaq 公開 API（真實即時報價 + 日線，免 key）；富途 OpenD 為後續升級路線
- 圖表：TradingView lightweight-charts
- 評分：專家 100 分模型（基本面 30 / 估值 20 / 技術 30 / 情緒宏觀 20）
- 增強：Fable 四件套（研究備忘錄 / 失效條件 / 規則追溯 / 策略審查）
- 框架：Next.js 16 + React 19

## 本地跑

```bash
npm ci
npm run dev          # http://localhost:3000
npm test             # 指標、買點、評分、API 與搜尋回歸測試
npm run lint         # ESLint CLI + Next.js／TypeScript 規則
```

## 數據真實度

| 數據 | 來源 | 狀態 |
|---|---|---|
| 即時報價 | Nasdaq 公開 API | ✅ 真實 |
| 日線 K 線 | Nasdaq 公開 API | 至少 200 根有效日線才產生報告 |
| 財務/估值 | Nasdaq 年報 / 推導 | 無法取得時標記未知、不計分 |
| 評級/新聞/分時 | 尚未接入真實源 | 真實模式標記未知，不生成假資料 |

`/api/report` 預設使用真實模式。`REAL_DATA=false npm run dev` 明確啟用示範模式，報告會顯示模擬資料提示。真實模式不自動退回 mock：代號格式錯誤回傳 400，供應商明確表示不存在回傳 404；連線失敗、報價不可用或日線不足回傳 503。

評分完整度按 100 分模型的可用權重計算，並非資料真實度。未知項不計分，也不放大其餘分數；有缺失時顯示「資料不足 / 暫不評級」。目前真實評級尚未接入，因此真實報告只顯示已知部分得分。

策略審查檢查 `停損 < 入場 < 目標` 與至少 2 的毛風險回報。費用、滑價、回測與不同市場狀態尚未驗證，會顯示「未驗證」；價格或風險回報不合格則拒絕。

## 指標與買點定義

- EMA 以首個完整週期的 SMA 初始化；完整快照至少需要 200 根有效、時間遞增且不重複的日線。
- RSI(14) 使用 Wilder 平滑；無漲跌時為 50。MACD(12,26,9) 的訊號線為歷史有效 MACD 序列的 EMA9，暖機不足時不生成訊號線。
- KD(9,3,3) 由 RSV 遞迴計算，K、D 初始為 50，平滑權重為 1/3。ATR(14) 使用 Wilder 平滑，第一筆 true range 為 high-low，後續納入隔日跳空。
- 原日線 VWAP 已改為「20 日成交量加權均價」：最近 20 根日線的 `(high + low + close) / 3` 按成交量加權，並非盤中成交 VWAP。零成交量時為未知、不計入該項技術分數。
- 買點須同時符合：至少 200 根日線、收盤突破前 5 根高點、成交量達前 20 根平均的 1.5 倍、EMA20 > EMA50 > EMA200、收盤高於 EMA20 及 20 日成交量加權均價。高位與參考均量不包含訊號當根；所有條件只用訊號日及之前資料，保留最近 3 個訊號。
- 日線訊號需收盤後確認；當日訊號等到美東 16:00（自動處理夏令時間），提早收市日也保守等到 16:00。下一交易時段才可評估執行。這些條件尚未經費用與樣本外回測驗證；沒有符合訊號時不畫買入箭嘴。

## 資料 API

`/api/quote`、`/api/candles`、`/api/financials`、`/api/valuation`、`/api/ratings`、`/api/news` 現在統一回傳：

```json
{"symbol":"US.AAPL","mode":"real","source":"nasdaq","data":{}}
```

`data` 為原本的資料物件／陣列，呼叫者需要由 `body.data` 取出，不再直接讀取裸物件／陣列。現有搜尋介面已同步更新；`/api/report` 保留完整報告格式，以 `mode` 與 `sources` 標記資料。

- 所有股票資料 API 共用代號格式及真實模式存在性驗證。`REAL_DATA=false` 時所有入口都使用明確示範模式，不連線取真實資料。
- 真實新聞／分時尚未接入時回傳 `source: "unknown", data: []`；評級及缺失財務／估值回傳 `source: "unknown", data: null`。連線失敗或日線不可用回傳 503，代號不存在回傳 404，格式或 range 錯誤回傳 400，皆不退回 mock。
- `candles?range=day|week|month|1D`：週線以 UTC 週一、月線以 UTC 一日為日期標籤，使用首筆 open、最高 high、最低 low、末筆 close、成交量總和。聚合結果以 `source: "derived"` 標記，`inputSource` 說明底層為 Nasdaq 或 mock。首末期間可能只有部分日線。
- `/api/search?q=AAPL` 回傳 `{query, mode, source, data: [...]}`。真實模式目前支援代號查詢；供應商確認無結果回傳空陣列，服務不可用回傳 503。示範模式可搜尋內建公司名稱。
- 搜尋介面延遲 250ms 發出請求，取消舊請求並忽略過期結果／錯誤，清空輸入、關閉建議或離開頁面時停止待處理工作。

ESLint 使用相容於現有 Next.js 插件 peer requirements 的 9.x 與 `eslint-config-next`，不再使用 Next 16 已移除的 `next lint`。Lockfile 的套件 URL 已改為官方 HTTPS registry，保留所有原有套件版本與完整性雜湊。

## 畫面驗收

`npm run test:ui` 先建置正式版，再啟動示範及真實模式，使用 Chromium 驗收桌面與 390px 手機版。涵蓋搜尋、報告、圖表繪製、資料來源展開、橫向溢出、錯誤提示及取消搜尋，共 28 項檢查。真實模式需要能連線至 `api.nasdaq.com`。

有 `/usr/bin/chromium` 時直接使用；亦可用 `CHROMIUM_EXECUTABLE` 指定路徑，否則先執行 `npx playwright install chromium`。測試報告及失敗追蹤保存在 `.playwright/`，以 `npx playwright show-report .playwright/report` 查看。雲端執行可設定 `XDG_CONFIG_HOME=/workspace/.config`、`XDG_CACHE_HOME=/workspace/.cache`。

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
lib/futu          Nasdaq client + 明確示範模式
components/report  11 區塊報告視圖
```
