# 即時美股分析助手

輸入一個美股代號 → 產出「評分 → 買入時機 → 買入理由（圖+新聞）→ 日線圖」的單股決策報告。

- 數據：Nasdaq 公開 API（真實即時報價 + 日線，免 key）；富途 OpenD 為後續升級路線
- 圖表：TradingView lightweight-charts
- 評分：研究用加權模型（基本面 30 / 估值 20 / 技術 30 / 情緒宏觀 20）
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
| 報價 | Nasdaq 公開 API | 保留來源值；即時／延遲狀態按供應商標示，否則未知 |
| 日線 K 線 | Nasdaq 公開 API | 至少 200 根有效日線才產生報告 |
| 財務/估值 | Nasdaq 年報 / 推導 | 無法取得時標記未知、不計分 |
| 個股新聞 | Google News RSS | 免費、免 API key；失敗標記未知 |
| 評級/分時 | 尚未接入真實源 | 真實模式標記未知，不生成假資料 |

`/api/report` 預設使用真實模式。`REAL_DATA=false npm run dev` 明確啟用示範模式，報告會顯示模擬資料提示。真實模式不自動退回 mock：代號格式錯誤回傳 400，供應商明確表示不存在回傳 404；連線失敗、報價不可用或日線不足回傳 503。

評分與資料覆蓋率分開：`score.total = 已知得分 ÷ 可用權重 × 100`，無可用權重為 `null`。原本權重為基本面 30、估值 20、技術 30、情緒／宏觀 20；缺項退出分母，不當零分。例：取得原本 80 分的項目、得 60 分，顯示已知評分 75/100、覆蓋 80%。`earnedPoints` 保留原始已知得分，`dimensions` 各自提供正規化分數、覆蓋率及缺項。未知、實際零分及負值維持不同語義。各基本面輸入獨立封頂，避免強勁營收替缺失 EPS 或零增長 EPS 補分。ROE 只在基本面計分，取消 P/B 的重複 ROE 加分；P/B 維持六分權重與原有分段，缺 ROE 不會牽連估值。

有缺失時，`tier` 為「已知項目評分（非完整總評）」；完整資料只顯示模型強弱，不再由分數直接產生「強烈建議買入」或「避開／賣出」。覆蓋率不是準確率、置信機率或獲利機率；少量資料可得到高分，但不代表已完成整體評估，缺項不同的股票不能只比較總分。

報價下方的「資料缺失總覽」集中列出獨立缺項總數、所屬部分、狀態及影響；逐項檢查財務欄位，評級重複代理與量價衍生項會合併計數。實際披露零值不算缺失，成功確認無新聞不算失敗。新聞暫停及策略回測／費用等未驗證項目另列，不混入資料缺項總數；總數不參與評分。

### 按用途判斷策略，不以缺資料當利淡

`/api/report` 新增 `strategy`，技術與基本面／估值獨立評估，每項條件為 `true`（達標）、`false`（有資料證明未達標）或 `null`（未能判斷）。不依賴新聞、分析師評級或整體評分來封鎖技術機會。

- 技術策略：只使用已收盤日線，至少 200 根、有效成交量及報價、正 ATR；最新已收盤日線超過四個曆日即暫停當前訊號。四日是保守時效門檻，未接入交易所日曆，長假可能需要人工核對。依原有突破、1.5 倍量、EMA 與加權均價規則，檢查最新日線，而不是沿用較早的歷史買點；本次報價亦須維持突破及量價支持。
- 入場參考採本次報價，目標及止損由已收盤日線近期高低價和實際 ATR 推導。必須價格次序有效、毛風險回報至少 2:1；報價未確認即時時明確提醒下單前核價。目標不是保證能到達的價格。
- 技術狀態分「符合入場條件」、「等待觸發」、「條件不符合」、「資料不足」。缺資料時 `plan` 及 `referencePlan` 為 `null`；無效價格次序或零 ATR 亦不提供參考價。條件尚未成立但資料有效時，價位僅標為觀察參考。歷史圖表箭嘴不是當前入場推薦。
- 基本面／估值：各自所需資料完整、兩部分各達 65/100 才通過研究門檻；通過後仍需技術策略條件同時成立，才顯示「符合入場條件」；未觸發時顯示「等待觸發」，技術資料不足或條件不符亦會逐項顯示。缺任何必要財務或估值項目顯示「資料不足」，但保留已知分數，技術策略仍獨立運作。EPS／PEG 的 SEC 補充來源尚未完成真實連線驗收，資料仍可能缺失，不能預先視為完整研究門檻已通過。
- 65 分及 2:1 是沿用模型分界的研究參數，尚未以回測證明有效。手續費、點差、滑價及樣本外驗證仍為未驗證；此修改不代表已完成策略盈利驗證。

API 相容性：`score.total` 現在可為 `null`，語義由原始得分改成已知項目正規化分數；原始得分改讀 `score.earnedPoints`。`plan` 現在可為 `null`。前端與 API 同時更新，其他消費者亦須同步處理。

策略審查檢查 `停損 < 入場 < 目標` 與至少 2 的毛風險回報。費用、滑價、回測與不同市場狀態尚未驗證，會顯示「未驗證」；價格或風險回報不合格則拒絕。

財務欄位逐項保留 `null`：缺值、N/A、不可計算的比率不轉成 0 或 99，已披露的零和負值則保留。Nasdaq 此端點未提供已核對 EPS；可選 SEC 補充來源已接線，須符合下述設定與比較條件。未取得或不可比時 EPS 增長及 PEG 仍為未知。淨利增長獨立顯示，不替代 EPS 評分。ROIC 使用同期披露數字與實際有效稅率，沒有 21% 假設或稅率夾限；其為使用期末債務及權益的簡化推導值。跨表財年不一致時不混算。

報告「財務數值與缺失說明」列出數值、財年及計法。基本面子項缺部分輸入時，保留已知部分得分、降低相應可用權重並列出缺失名稱，不當作整組資料齊全；得分亦不超過已知部分的權重上限。財務 API 的 `notes` 解釋各欄位用途及不適用條件。

## 非新聞資料真實性與限制

正式 Worker 設定 `REAL_DATA=true`、`NEWS_ENABLED=false`：新聞暫停，不發出外部新聞請求；其餘資料維持真實模式，缺失不退回 mock。示範模式只供明確的開發測試，公開 API 的查詢參數不能切換模式。

- 報價缺失的漲跌、百分比、成交量、市值及供應商目標價保留 null，不補 0。缺最後價格時回傳資料不可用。
- `timestamp` 是已核對的成交 epoch；目前真實供應商時間只保留原始 `asOf` 文字，無法核對時 `timestamp=null`。`fetchedAt` 是讀取時間，不能當成交時間。`isRealTime` 僅在供應商明確提供時填寫，否則未知，不承諾即時。
- 股票及 ETF 共用完整 OHLCV 驗證；缺成交量、錯誤日期、重複日線或不合理高低價都拒絕，不將缺成交量填零，不靜默刪除壞列。明確披露的零成交量保留。產業比較要求兩個 ETF 的比較日期一致。
- 均線、技術指標、估值、大盤／產業趨勢屬真實輸入的推導；評分、買點、參考目標價、停損及研究框架屬模型輸出，並非供應商披露或已驗證盈利結論。ATR 為零時保留零，不以價格 2% 代替；無有效 ATR 時不生成參考價。
- 報價、財報及歷史資料的供應商準確性、更新延遲、拆股／股息調整與是否包含事後修訂，尚未逐筆以獨立來源核實。來源標籤只代表資料來源，不是真實性認證。

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
- 真實分時尚未接入時回傳 `source: "unknown", data: []`；新聞依暫停設定或 Google RSS 狀態回傳（見下節）。評級及缺失財務／估值回傳 `source: "unknown", data: null`。股票驗證連線失敗或日線不可用回傳 503，代號不存在回傳 404，格式或 range 錯誤回傳 400，皆不退回 mock。
- `candles?range=day|week|month|1D`：週線以 UTC 週一、月線以 UTC 一日為日期標籤，使用首筆 open、最高 high、最低 low、末筆 close、成交量總和。聚合結果以 `source: "derived"` 標記，`inputSource` 說明底層為 Nasdaq 或 mock。首末期間可能只有部分日線。
- `/api/search?q=AAPL` 回傳 `{query, mode, source, data: [...]}`。真實模式支援代號及英文公司名稱；由 Nasdaq 免費 screener 的 NASDAQ／NYSE／AMEX 名單查詢，最多十項結果。無匹配回傳空陣列及訊息，服務不可用或名單不完整回傳 503。示範模式只搜尋內建代號及公司名稱，不製造未知代號結果。
- 搜尋介面延遲 250ms 發出請求，取消舊請求並忽略過期結果／錯誤，清空輸入、關閉建議或離開頁面時停止待處理工作。

ESLint 使用相容於現有 Next.js 插件 peer requirements 的 9.x 與 `eslint-config-next`，不再使用 Next 16 已移除的 `next lint`。Lockfile 的套件 URL 已改為官方 HTTPS registry，保留所有原有套件版本與完整性雜湊。

## 免費個人研究流程

第一階段供個人非商業使用：搜尋代號 → 真實資料及 Google News RSS → 清楚顯示資料缺失。以 AAPL、MSFT、TSLA 驗收；自動選股、交易週期及交易計畫增強留待下一階段。

Google News RSS 為預設新聞來源，免費，毋須 API key。雲端允許 HTTPS 存取 `news.google.com` 即可；其他真實資料仍需 `api.nasdaq.com`。Finnhub adapter 保留作後續選擇，不會自動呼叫，也不需配置其憑證。

報告與 `/api/news?symbol=AAPL` 共用最近七日的代號搜尋結果，去重、按發布時間排序、最多十條；報告顯示前三條的標題、出版來源及時間。連結保留 Google 跳轉至出版商，不抓取全文。關鍵字搜尋可能包含不相關新聞，不參與評分或買入訊號。RSS 依 Google feed 聲明限個人、非商業 feed reader 用途；不作公開新聞再發布服務。

`status: ready|empty` 表示成功讀取（包括確認沒有近期新聞），`source: google_news`；`unavailable|rate_limited` 表示失敗，`source: unknown`，資料為空陣列，並提供 `message`。報告繼續顯示其他資料，失敗不補假新聞。`fetchedAt`／`newsFetchedAt` 為本次讀取時間，RSS 請求快取最多五分鐘；各篇發布時間分開顯示。示範模式維持 mock，不連外。

Cloudflare Workers 請求使用 `redirect: manual`，只允許同一 HTTPS Google RSS 搜尋端點最多兩次正常重新導向；不同網站、驗證頁、循環或 HTTP 錯誤均保持未知，提示實際 HTTP 狀態。自動讀取失敗時提供 Google News 原頁閱讀入口，不將入口連結當成已取得的新聞。正式環境曾回傳上游 HTTP 503；本地讀取成功不保證 Google 接受 Cloudflare 的請求。

### 新聞失敗日誌

Cloudflare → Workers & Pages → us-stock → Observability／Logs，開啟即時日誌後，在另一個分頁請求 `/api/news?symbol=AAPL`。接口亦回傳有限的 `diagnostic` 分類資訊供直接排查；不需日誌權限即可查看狀態及提示分類。回應的 `diagnosticId` 可對應 `news-google-failure` 結構化日誌。Worker 接口本身可能回傳 HTTP 200；Google 的狀態要看日誌 `upstreamStatus`，不要混淆兩者。

日誌包含 `phase`（fetch、http_response、read_body、parse_rss）、`upstreamStatus`、`contentType` 及 `hint`。錯誤頁只檢查前 8 KiB，分類為 `automated_request_notice`（偵測到自動查詢提示）、`consent_notice`、`server_unavailable_notice` 或 `unclassified`；這些是頁面內容線索，並非單憑狀態碼判斷封鎖。`unclassified` 代表仍未能確認原因。網絡／解析失敗另記錄錯誤名稱，不記錄原始例外訊息。日誌不保留完整錯誤頁、新聞全文、Cookie 或憑證。

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
lib/scoring        已知項目加權評分及分維度覆蓋率
lib/fable          Fable 分析增強
lib/futu          Nasdaq client + 明確示範模式
components/report  11 區塊報告視圖
```


## 免費 SEC 年度 EPS 與歷史 PEG（接線完成，線上來源未驗收）

不用 API key 或付費方案。伺服器設定 `SEC_USER_AGENT` 為專案名稱及真實聯絡電郵（本地放 ignored `.env.local`，部署時用主機環境變數；不要提交電郵到公開 repository）。讀取域名為 `www.sec.gov`、`data.sec.gov`。沒有合格識別時不發請求；403、429、逾時、重新導向或解析錯誤保持未知，不自動重試、不用 mock 補缺。每個執行個體以 250ms 間隔發請求，過多排隊直接回未知；這不代表多 Worker 的全域限流。ticker 名單使用 Next 24 小時快取、Company Facts 一小時快取。

先從 SEC `company_tickers.json` 唯一核對 ticker／CIK；同 CIK 多 ticker 的股份類別／ADR 情況保守不套用每股數字。只接受 US-GAAP `EarningsPerShareDiluted`、`USD/shares`、年度 10-K／20-F（含修訂），並對齊 Nasdaq 財年。當期及前期必須來自同一 accession／提交日期，期間約一年且長度可比；缺最新比較資料、存在衝突值、只有季度／基本 EPS／其他幣種時保持未知。

`financials.epsEvidence` 保留兩期數值、起止日、幣種／每股單位、CIK、申報編號、表單、提交日期與 SEC 連結。零及負 EPS 保留；上期非正數時同比百分比不適用。使用同一申報的比較資料可避免自行拼接不同重述口徑，但仍不代表已逐筆核實拆股或完成歷史時點驗證。

PEG 為研究用「歷史年度 PEG」：Nasdaq 市值／該年度淨利，再除 SEC 年度攤薄 EPS 同比增長的百分點數（例如 20，不是 0.2）。只有已附 SEC 證據且增長正數才計算；不是 TTM PEG、分析師預期 PEG 或供應商直接報值。報告細項顯示 `pegBasis`，EPS 財務明細附原始出處。報告與獨立財務／估值端點共用同一補充流程；混合財務回應以 `source: derived` 及 `sources` 分別標記 Nasdaq／SEC。

已通過受控資料測試，並於 2026-10-25 使用使用者提供的 Apple SEC JSON 做離線解析核對：2025／2024 年度攤薄 EPS 為 7.46／6.08，同比增長約 22.70%，財年末分別為 2025-09-27／2024-09-28。詳見 [檔案核對紀錄](SEC-UPLOAD-VERIFICATION.md)。2026-10-24 雲端檢查在代理連線階段失敗，自動讀取仍未驗收；離線檔案成功不代表 Worker 已接通。環境變數草稿保存不代表已套用到 Worker，也未部署。

### 使用者手動核對

先在自己瀏覽器開 `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json`（Apple）。若出現 JSON，搜尋 `EarningsPerShareDiluted`，確認 `USD/shares`、`start/end`、`filed/accn` 欄位存在；可將檔案下載後交回驗證實際格式。如顯示存取限制或錯誤，回報頁面提示即可，無需反覆刷新。瀏覽器可讀不代表 Cloudflare 自動請求一定可讀；後者仍待未來部署後獨立驗收。


## 財年、市值與 PEG 的同批核對

SEC 補充資料在合併財務時會再次檢查財年期末是否完全一致，並重算兩期 EPS 的增長，不能以 9 月 30 日代替 9 月 27 日。估值層亦會再次驗證財年、EPS 指標／單位及增長是否與原始數字一致；資料不一致保持未知，避免只靠 `source: sec` 標記通過。這些是程式防護，並非已完成 Nasdaq 真實資料對齊。

Nasdaq summary 的市值讀取明確使用 `cache: no-store`。每次伺服器收到報告／估值請求時按需讀取；不定時掃描。供應商或其 CDN 可能仍有延遲，未提供可核對的市值更新時間／頻率，所以 `marketCapSnapshot.asOf` 為 null，不能將 `fetchedAt` 讀取時間冒充成更新或成交時間。

報告新增 `valuation` 與 `marketCap`，估值端點也保留 `marketCapSnapshot`、`financialPeriodEnd`、`annualNetIncomeUSD`、`pegMessage`。畫面的「估值輸入與更新時間」列出原始市值、來源、讀取時間、未知的供應商更新時間、年度淨利、年度 P/E 及歷史 PEG。缺市值或不適用時不補值；市值來源紀錄與計算輸入矛盾時不計估值。

已使用使用者提供的兩份 Nasdaq 原頁 JSON 完成 Apple 離線核對（詳見 [核對紀錄](SEC-UPLOAD-VERIFICATION.md)）：財年 2025-09-27 與 SEC 一致，本期／上期淨利的千美元換算均與 SEC 原始美元數字一致。按上傳市值快照計，年度 P/E 約 45.31、歷史 PEG 約 2.00；市值更新時間仍未知，自動線上讀取亦未驗收。原始端點為：

- `https://api.nasdaq.com/api/quote/AAPL/summary?assetclass=stocks`：市值與來源欄位。
- `https://api.nasdaq.com/api/company/AAPL/financials?frequency=1`：財年、淨利及單位。

雲端代理先前受阻，本批沒有重試連線。原頁若無法開啟，回報錯誤即可，不反覆刷新。已有 Apple SEC 上傳檔案不會自動變成正式資料來源或生產 fallback；只就同財年財務及已核對的上傳市值快照計算，不將其稱為 Apple 即時 PEG。


## 本次版本部署驗收

`/api/version` 應回傳 `release: 2026-10-25-real-data-v2.3`、`mode: real`、`newsEnabled: false`。`secConfigured` 只顯示是否有格式正確的聯絡識別，不回傳電郵或憑證，也不代表 SEC 連線已通過。設定需在 Cloudflare 的 Worker `us-stock` → Settings → Variables and Secrets 加入 `SEC_USER_AGENT`（使用已提供的專案名稱及聯絡電郵），並發佈設定；本地 `.env.local` 和雲端環境草稿不會自動傳入正式 Worker。若有 Build variables／Runtime variables 分開選項，需設定到執行環境。

GitHub main 更新可供現有 Cloudflare Git 連線觸發建置，但推送成功不等於部署成功。請以 Cloudflare 部署紀錄及正式網站 `/api/version` 核對；維持 `REAL_DATA=true`、`NEWS_ENABLED=false`，不為完成部署切換成示範資料。

Wrangler 已設定 `keep_vars: true`，保留 Dashboard 管理的執行變數，避免後續 Git 部署刪除 `SEC_USER_AGENT`；程式碼明確宣告的 REAL_DATA／NEWS_ENABLED 仍按此版本設定。

首頁及報告頁頂部顯示明顯的「版本 V2.3」標籤；`lib/version.ts` 為畫面與 `/api/version` 的共用版本來源。


## V2.3：不適用與資料時效

PEG 增長非正數時由估值層標記 `not_applicable`，獨立顯示，不混入資料缺項，不當零分。已知項目分數及原始因子權重不變；覆蓋率改為可用權重／適用權重，不適用權重另列。例如原本 100 權重中 PEG 6 不適用、評級 13 未取得，覆蓋率為 81/94＝86.17%，不是準確率。估值的適用項目齊全時可以評估研究門檻；若有資料證明基本面或估值未達標，顯示條件不符合，不被其他未知項覆蓋。

當前交易參考新增報價／日線日期檢查。已核對 epoch 使用美東日期，原始 asOf 僅辨認明確日期標籤；不猜測不明時區，不使用 fetchedAt 補作成交時間。報價日期未知、早於最後已收盤日線或在未來時，暫停當前入場參考價，保留評分及歷史日線研究。日期相符仍不代表分鐘級即時性已驗證。市值更新時間未知亦列入缺項總覽，歷史 PEG 保持為讀取輸入的研究值。

本次沒有直接更改 Nasdaq 日期，也沒有宣稱找到一日差異的根因；上游時間標記與交易日曆仍需另行核實。

即時標記優先核對 `primaryData.isRealTime`，相容外層舊欄位；兩者衝突時保持未知。2026-10-25 單次 Nasdaq 原始回應確認 AAPL 的 primaryData 為 false、來源日期仍為 Oct 22, 2026；沒有因為解析修正而更改供應商日期。
