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
| 個股新聞 | Google News RSS | 免費、免 API key；失敗標記未知 |
| 評級/分時 | 尚未接入真實源 | 真實模式標記未知，不生成假資料 |

`/api/report` 預設使用真實模式。`REAL_DATA=false npm run dev` 明確啟用示範模式，報告會顯示模擬資料提示。真實模式不自動退回 mock：代號格式錯誤回傳 400，供應商明確表示不存在回傳 404；連線失敗、報價不可用或日線不足回傳 503。

評分完整度按 100 分模型的可用權重計算，並非資料真實度。未知項不計分，也不放大其餘分數；有缺失時顯示「資料不足 / 暫不評級」。目前真實評級尚未接入，因此真實報告只顯示已知部分得分。

策略審查檢查 `停損 < 入場 < 目標` 與至少 2 的毛風險回報。費用、滑價、回測與不同市場狀態尚未驗證，會顯示「未驗證」；價格或風險回報不合格則拒絕。

財務欄位逐項保留 `null`：缺值、N/A、不可計算的比率不轉成 0 或 99，已披露的零和負值則保留。Nasdaq 此端點未提供已核對 EPS，因此 EPS 增長及 PEG 為未知，淨利增長獨立顯示，不替代 EPS 評分。ROIC 使用同期披露數字與實際有效稅率，沒有 21% 假設或稅率夾限；其為使用期末債務及權益的簡化推導值。跨表財年不一致時不混算。

報告「財務數值與缺失說明」列出數值、財年及計法。基本面子項缺部分輸入時，保留已知部分得分、降低相應可用權重並列出缺失名稱，不當作整組資料齊全；得分亦不超過已知部分的權重上限。財務 API 的 `notes` 解釋各欄位用途及不適用條件。

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
- 真實分時尚未接入時回傳 `source: "unknown", data: []`；新聞依 Finnhub 狀態回傳（見下節）。評級及缺失財務／估值回傳 `source: "unknown", data: null`。股票驗證連線失敗或日線不可用回傳 503，代號不存在回傳 404，格式或 range 錯誤回傳 400，皆不退回 mock。
- `candles?range=day|week|month|1D`：週線以 UTC 週一、月線以 UTC 一日為日期標籤，使用首筆 open、最高 high、最低 low、末筆 close、成交量總和。聚合結果以 `source: "derived"` 標記，`inputSource` 說明底層為 Nasdaq 或 mock。首末期間可能只有部分日線。
- `/api/search?q=AAPL` 回傳 `{query, mode, source, data: [...]}`。真實模式支援代號及英文公司名稱；由 Nasdaq 免費 screener 的 NASDAQ／NYSE／AMEX 名單查詢，最多十項結果。無匹配回傳空陣列及訊息，服務不可用或名單不完整回傳 503。示範模式只搜尋內建代號及公司名稱，不製造未知代號結果。
- 搜尋介面延遲 250ms 發出請求，取消舊請求並忽略過期結果／錯誤，清空輸入、關閉建議或離開頁面時停止待處理工作。

ESLint 使用相容於現有 Next.js 插件 peer requirements 的 9.x 與 `eslint-config-next`，不再使用 Next 16 已移除的 `next lint`。Lockfile 的套件 URL 已改為官方 HTTPS registry，保留所有原有套件版本與完整性雜湊。

## 免費個人研究流程

第一階段供個人非商業使用：搜尋代號 → 真實資料及 Google News RSS → 清楚顯示資料缺失。以 AAPL、MSFT、TSLA 驗收；自動選股、交易週期及交易計畫增強留待下一階段。

Google News RSS 為預設新聞來源，免費，毋須 API key。雲端允許 HTTPS 存取 `news.google.com` 即可；其他真實資料仍需 `api.nasdaq.com`。Finnhub adapter 保留作後續選擇，不會自動呼叫，也不需配置其憑證。

報告與 `/api/news?symbol=AAPL` 共用最近七日的代號搜尋結果，去重、按發布時間排序、最多十條；報告顯示前三條的標題、出版來源及時間。連結保留 Google 跳轉至出版商，不抓取全文。關鍵字搜尋可能包含不相關新聞，不參與評分或買入訊號。RSS 依 Google feed 聲明限個人、非商業 feed reader 用途；不作公開新聞再發布服務。

`status: ready|empty` 表示成功讀取（包括確認沒有近期新聞），`source: google_news`；`unavailable|rate_limited` 表示失敗，`source: unknown`，資料為空陣列，並提供 `message`。報告繼續顯示其他資料，失敗不補假新聞。`fetchedAt`／`newsFetchedAt` 為本次讀取時間，RSS 請求快取最多五分鐘；各篇發布時間分開顯示。示範模式維持 mock，不連外。

## 第二階段：按需搜尋全美股

全美股指搜尋範圍，不是定時全市場掃描。首次查詢才讀取三個交易所的股票名單，快取一小時，並合併同時發出的請求；搜尋不取得每隻股票的報價、財務或新聞。選擇結果或以 Enter 確認唯一結果後，才開啟該股票報告。輸入有多個匹配時需自行選擇。

支援代號前綴、大小寫、`US.` 前綴、英文公司名稱關鍵字，以及 `BRK/B` → `BRK.B` 股份類別。排序先完全相同代號，再代號前綴及公司名稱。一般以 NYSE、Nasdaq、NYSE American 普通股／ADR 為目標；根據供應商證券名稱排除 ETF、基金、優先股、認股權證、units、rights 及債券。供應商沒有完整證券類別欄位，名稱分類可能遺漏，並非獨立驗證的完整證券主檔；不涵蓋 OTC，也不保證每隻股票都有足夠財務或歷史資料。

名單缺頁、任一交易所請求失敗或格式錯誤會提示服務不可用，不偽裝成查無股票。查無結果與無效輸入分開提示；清空、關閉或修改輸入會取消搜尋及待處理的 Enter 導航。

## 畫面驗收

`npm run test:ui` 先建置正式版，再啟動示範及真實模式，使用 Chromium 驗收桌面與 390px 手機版。涵蓋搜尋、報告、圖表繪製、資料來源展開、橫向溢出、錯誤提示及取消搜尋，包含 AAPL、MSFT、TSLA 及 Google 新聞與錯誤狀態檢查。真實模式需要能連線至 `api.nasdaq.com` 及 `news.google.com`。

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
