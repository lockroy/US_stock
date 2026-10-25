import { test, expect, type Page } from "@playwright/test";
import { score, type ScoreInput } from "../../lib/scoring/scoring";
import { assessStrategy } from "../../lib/fable/strategy";
import { audit, buildMemo, buildRules, findBuyPoints } from "../../lib/fable/fable";
import { computeIndicators } from "../../lib/indicators/indicators";
import type { StockReport } from "../../lib/types";
import { parseAnnualEps } from "../../lib/futu/sec";
import calendar from "../../lib/market/xnys-sessions.json";
import { calendarSnapshot } from "../../lib/market/calendar";
import { quoteDay } from "../../lib/fable/timeliness";
import { buildComparability, parseDividends, unavailableDividends } from "../../lib/futu/corporate-actions";

function refreshStrategyFixture(report: StockReport, inputs: Partial<ScoreInput> = {}) {
  const now = new Date("2026-10-16T20:01:00Z");
  const indicators = computeIndicators(report.candlesDaily);
  report.score = score({ financials: null, valuation: null, ratings: null, marketTrendUp: null, sectorStrong: null, indicators, ...inputs });
  report.valuation = inputs.valuation ?? null;
  report.strategy = assessStrategy(report.score, report.candlesDaily, report.quote, now);
  report.plan = report.strategy.technical.referencePlan;
  report.memo = buildMemo(indicators, report.candlesDaily);
  report.rules = buildRules(report.memo);
  report.buyPoints = findBuyPoints(report.candlesDaily, now);
  report.audit = audit(report.score, report.memo, report.plan);
  report.timing = { calendar: calendarSnapshot(now), quoteDate: quoteDay(report.quote),
    lastAvailableDailyDate: new Date(report.candlesDaily.at(-1)!.time * 1000).toISOString().slice(0, 10),
    lastClosedDailyDate: report.strategy.technical.evaluatedBarTime === null ? null : new Date(report.strategy.technical.evaluatedBarTime * 1000).toISOString().slice(0, 10) };
}

async function strategyFixture(request: import("@playwright/test").APIRequestContext) {
  const response = await request.get("http://127.0.0.1:3050/api/report?symbol=AAPL");
  expect(response.ok()).toBe(true);
  const report: StockReport = await response.json();
  const days = Object.keys(calendar.sessions).filter(d => d <= "2026-10-16").slice(-200);
  report.candlesDaily = days.map((date, i) => {
    const close = 100 + i * 0.1;
    return { time: Date.parse(`${date}T00:00:00Z`) / 1000, open: close, close, high: close + 0.2, low: close - 0.2, volume: 1000 };
  });
  report.candlesDaily[180].high = 150;
  Object.assign(report.candlesDaily[199], { open: 120.8, close: 120.8, high: 121, low: 120.6, volume: 1500 });
  report.mode = "real";
  report.candlesIntraday = [];
  report.financials = null;
  Object.assign(report.quote, { lastPrice: 120.8, change: null, changePct: null, volume: null, timestamp: null, isRealTime: null, asOf: "Oct 16, 2026" });
  report.news = [];
  report.newsStatus = "disabled";
  report.newsMessage = "新聞功能暫停，未請求外部新聞來源。";
  refreshStrategyFixture(report);
  report.sources = { quote: "nasdaq", candlesDaily: "nasdaq", financials: "unknown", valuation: "unknown", ratings: "unknown", news: "unknown", scoring: "derived" };
  return report;
}

test("SEC EPS evidence and historical PEG cannot look like forecast analyst data", async ({ page, request }) => {
  const report = await strategyFixture(request);
  const evidence = parseAnnualEps({ cik: 320193, facts: { "us-gaap": { EarningsPerShareDiluted: { units: { "USD/shares": [
    { start: "2024-10-01", end: "2025-09-30", val: 6, accn: "0000320193-25-000079", filed: "2025-11-01", form: "10-K", fp: "FY" },
    { start: "2023-10-01", end: "2024-09-30", val: 5, accn: "0000320193-25-000079", filed: "2025-11-01", form: "10-K", fp: "FY" },
  ] } } } } }, "0000320193", "9/30/2025", new Date("2026-10-24T00:00:00Z")).evidence!;
  report.financials = { revenueGrowth: 15, epsGrowth: 20, netIncomeGrowth: 10, grossMargin: 50, roe: 50, roic: 50, fcf: 1, debtToEquity: 0.5,
    periodEnd: "9/30/2025", epsEvidence: evidence };
  const pegBasis = "歷史年度 PEG＝年度 P/E ÷ SEC 年度攤薄 EPS 同比增長百分點；不是分析師預期 PEG。";
  refreshStrategyFixture(report, { financials: report.financials, valuation: { pe: 25, peg: 1.25, pb: 3, ps: null, evSales: null, fcfYield: 3, pegBasis } });
  report.sources.financials = "nasdaq";
  report.sources.valuation = "derived";
  report.sources.epsGrowth = "sec";
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await expect(page.getByText("EPS·SEC 原始申報", { exact: true })).toBeVisible();
  await expect(page.getByText(pegBasis, { exact: true })).toBeVisible();
  await page.getByText("財務數值與缺失說明", { exact: true }).click();
  await expect(page.getByText("EPS 增長：20%", { exact: true })).toBeVisible();
  await expect(page.getByTestId("eps-evidence")).toContainText("2025-09-30：6；2024-09-30：5");
  await expect(page.getByTestId("eps-evidence")).toContainText("提交日期：2025-11-01");
  const link = page.getByRole("link", { name: "核對 SEC 原始 EPS 資料" });
  await expect(link).toHaveAttribute("href", evidence.url);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByTestId("missing-data-summary").locator('[data-missing-id="financials.epsGrowth"]')).toHaveCount(0);
  report.marketCap = { value: 1_000_000, currency: "USD", source: "nasdaq", fetchedAt: 1792368000, asOf: null, refreshPolicy: "on-demand-no-store" };
  report.valuation = { ...report.valuation!, financialPeriodEnd: "9/30/2025", annualNetIncomeUSD: 40_000 };
  await page.reload();
  await page.getByText("估值輸入與更新時間", { exact: true }).click();
  const valuation = page.getByTestId("valuation-inputs");
  await expect(valuation).toContainText("市值（美元）：1,000,000");
  await expect(valuation).toContainText("市值供應商更新時間：未知；供應商更新頻率：未知");
  await expect(valuation).toContainText("不是供應商更新時間");
  await expect(valuation).toContainText("歷史年度 PEG：1.25");
  await noOverflow(page);
});

test("inapplicable PEG is separate from missing data and an older quote cannot yield a current entry", async ({ page, request }) => {
  const report = await strategyFixture(request);
  const parsed = parseAnnualEps({ cik: 320193, facts: { "us-gaap": { EarningsPerShareDiluted: { units: { "USD/shares": [
    { start: "2024-10-01", end: "2025-09-30", val: 1, accn: "0000320193-25-000079", filed: "2025-11-01", form: "10-K", fp: "FY" },
    { start: "2023-10-01", end: "2024-09-30", val: 2, accn: "0000320193-25-000079", filed: "2025-11-01", form: "10-K", fp: "FY" },
  ] } } } } }, "0000320193", "9/30/2025", new Date("2026-10-24T00:00:00Z"));
  report.financials = { revenueGrowth: -3, epsGrowth: parsed.growth, netIncomeGrowth: -40, grossMargin: 18,
    roe: 4, roic: 3, fcf: 1, debtToEquity: 0.1, periodEnd: "9/30/2025", epsEvidence: parsed.evidence };
  const valuation = { pe: 387, peg: null, pb: 17, ps: null, evSales: null, fcfYield: 1,
    pegApplicability: "not_applicable" as const, pegMessage: "歷史 EPS 增長非正數，PEG 不適用。" };
  const inputs = { financials: report.financials, valuation, marketTrendUp: true, sectorStrong: true };
  refreshStrategyFixture(report, inputs);
  const originalScore = report.score.total;
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await expect(page.getByTestId("not-applicable-data")).toContainText("不適用資料：1 項");
  await expect(page.getByTestId("not-applicable-data")).toContainText("PEG：歷史 EPS 增長非正數");
  await expect(page.getByTestId("missing-data-list").locator('[data-missing-id="factor.估值.PEG"]')).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "不適用（不計分）", exact: true })).toBeVisible();
  await expect(page.getByTestId("dimension-估值")).toContainText("資料覆蓋 100%");
  await expect(page.getByTestId("fundamental-strategy")).toContainText("基本面／估值策略：條件不符合");
  report.quote.asOf = "Oct 15, 2026";
  refreshStrategyFixture(report, inputs);
  expect(report.score.total).toBe(originalScore);
  await page.reload();
  await expect(page.getByTestId("technical-strategy")).toContainText("技術策略：資料不足");
  await expect(page.getByTestId("technical-strategy")).toContainText("報價日期 2026-10-15，最後已收盤日線 2026-10-16");
  await expect(page.getByTestId("reference-plan")).toHaveCount(0);
  await expect(page.getByTestId("fundamental-strategy")).toContainText("基本面／估值策略：條件不符合");
  await noOverflow(page);
});

test("complete research inputs align scores, missing summary, stop and entry status", async ({ page, request }, info) => {
  // 受控情境驗收；不代表現時真實供應商已提供 EPS／PEG。
  const report = await strategyFixture(request);
  report.financials = { revenueGrowth: 15, epsGrowth: 15, netIncomeGrowth: 15, grossMargin: 50,
    roe: 50, roic: 50, debtToEquity: 0.5, fcf: 1, periodEnd: "2025-12-31" };
  Object.assign(report.quote, { change: 0.8, changePct: 0.67, volume: 1500, asOf: "Oct 16, 2026 4:01 PM ET", isRealTime: false });
  report.sources.financials = "nasdaq";
  report.sources.valuation = "derived";
  refreshStrategyFixture(report, { financials: report.financials,
    valuation: { pe: 10, peg: 1, pb: 1, ps: null, evSales: null, fcfYield: 8 }, marketTrendUp: true, sectorStrong: true });
  expect(report.score.completeness.percent).toBe(87); // 評級未接入，保留為未知
  expect(report.strategy.technical.rewardRisk).toBeGreaterThanOrEqual(2);
  expect(report.plan!.stop).toBeLessThan(report.plan!.entry);
  expect(report.plan!.entry).toBeLessThan(report.plan!.target);
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await reportReady(page);
  await expect(page.getByTestId("dimension-基本面")).toContainText("基本面：100/100");
  await expect(page.getByTestId("data-timing")).toContainText("正常交易日，預定 16:00 收市");
  await expect(page.getByTestId("data-timing")).toContainText("日曆預期最新已收盤日：2026-10-16");
  await expect(page.getByTestId("data-timing")).toContainText("市值更新時間仍未知");
  await expect(page.getByTestId("data-timing")).toContainText("第三方規則參考，非即時交易所公告");
  await expect(page.getByTestId("dimension-估值")).toContainText("估值：100/100");
  await expect(page.getByTestId("missing-data-count")).toHaveText("未齊全資料：2 項");
  await expect(page.getByTestId("missing-data-list").locator("[data-missing-id]")).toHaveCount(2);
  await expect(page.getByTestId("technical-strategy")).toContainText("技術策略：符合入場條件");
  await expect(page.getByTestId("fundamental-strategy")).toContainText("基本面／估值策略：符合入場條件");
  await expect(page.getByTestId("reference-plan")).toContainText(`模型停損點：$${report.plan!.stop}`);
  await expect(page.getByText("審查結果：未驗證", { exact: true })).toBeVisible();
  await expect(page.getByText(/報價未確認為即時；實際下單前須重新核對/)).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("complete-research-inputs.png"), fullPage: true });
});

test("historical comparability separates real event fields from unknown adjustments and historical availability", async ({ page, request }) => {
  const report = await strategyFixture(request);
  Object.assign(report.quote, { securityType: "American Depositary Shares", exchange: "NYSE" });
  report.comparability = buildComparability(report.quote, null, parseDividends({ data: { dividends: { rows: [
    { exOrEffDate: "8/10/2026", type: "Cash", amount: "$0.27", currency: "USD", paymentDate: "8/13/2026" },
  ] } } }, "AAPL"));
  const before = report.score.total;
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  const panel = page.getByTestId("data-comparability");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("可讀現金股息：1 筆");
  await panel.getByText("查看最近五筆除淨記錄", { exact: true }).click();
  await expect(panel).toContainText("除淨 2026-08-10 · 每股 0.27 USD");
  await expect(panel).toContainText("不代表日線已作除息調整");
  await expect(panel).toContainText("不能直接倒填到過去回測");
  await expect(panel).toContainText("American Depositary Shares");
  await expect(panel).toContainText("其他財報幣種／金額縮放尚未獨立交叉核對");
  for (const id of ["history.adjustment", "history.financials", "security.basis"]) await expect(page.locator(`[data-missing-id="${id}"]`)).toHaveCount(1);
  await noOverflow(page);
  report.comparability.dividends = unavailableDividends("AAPL");
  await page.reload();
  await expect(page.getByTestId("corporate-actions")).toContainText("不代表沒有派息");
  await expect(page.locator('[data-missing-id="dividends"]')).toHaveCount(1);
  expect(report.score.total).toBe(before);
});

test("partial scores keep technical opportunities separate from unknown fundamentals", async ({ page, request }, info) => {
  const report = await strategyFixture(request);
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await reportReady(page);
  await expect(page.getByTestId("dimension-基本面")).toContainText("未能評估");
  await expect(page.getByTestId("dimension-基本面")).toContainText("資料覆蓋 0%");
  await expect(page.getByTestId("technical-strategy")).toContainText("技術策略：符合入場條件");
  await expect(page.getByTestId("fundamental-strategy")).toContainText("基本面／估值策略：資料不足");
  await expect(page.getByText("已知項目評分（非完整總評）", { exact: true })).toBeVisible();
  await expect(page.getByText(/計分依據：已知得分 .* ÷ 可用權重 30 × 100/)).toBeVisible();
  await expect(page.getByTestId("reference-plan")).toContainText("條件成立的模型入場參考");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("partial-score-strategy.png"), fullPage: true });
});

test("missing data summary counts unique inputs and separates paused news and unverified research", async ({ page, request }) => {
  const report = await strategyFixture(request);
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  const summary = page.getByTestId("missing-data-summary");
  await expect(summary.getByTestId("missing-data-count")).toHaveText("未齊全資料：17 項");
  await expect(summary.locator("[data-missing-id]")).toHaveCount(17);
  await expect(summary.locator('[data-missing-id="ratings"]')).toHaveCount(1);
  await expect(summary.locator('[data-missing-id="financials.epsGrowth"]')).toContainText("EPS 增長");
  await expect(summary.locator('[data-missing-id="financials.fcf"]')).toContainText("自由現金流");
  await expect(summary.getByText("新聞：已暫停，另列顯示，不計入上述缺項總數。", { exact: true })).toBeVisible();
  await expect(summary.getByText("策略驗證待完成：5 項（不計入資料缺項）", { exact: true })).toBeVisible();

  report.financials = { revenueGrowth: 0, epsGrowth: 0, grossMargin: 0, roe: 0, roic: 0, debtToEquity: 0, fcf: 0, netIncomeGrowth: 0 };
  await page.reload();
  await expect(summary.getByTestId("missing-data-count")).toHaveText("未齊全資料：9 項");
  await expect(summary.locator('[data-missing-id^="financials."]')).toHaveCount(0);
  report.newsStatus = "unavailable";
  await page.reload();
  await expect(summary.getByTestId("missing-data-count")).toHaveText("未齊全資料：10 項");
  await expect(summary.locator('[data-missing-id="news"]')).toContainText("新聞資料");
  report.newsStatus = "empty";
  await page.reload();
  await expect(summary.getByTestId("missing-data-count")).toHaveText("未齊全資料：9 項");
  await expect(summary.locator('[data-missing-id="news"]')).toHaveCount(0);
  await noOverflow(page);
});

test("insufficient technical inputs hide entry prices without displaying a bearish score", async ({ page, request }) => {
  const report = await strategyFixture(request);
  report.candlesDaily = report.candlesDaily.map(c => ({ ...c, volume: 0 }));
  refreshStrategyFixture(report);
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await expect(page.getByTestId("technical-strategy")).toContainText("技術策略：資料不足");
  await expect(page.getByTestId("missing-data-summary").locator('[data-missing-id="technical.volume"]')).toHaveCount(1);
  await expect(page.getByTestId("reference-plan")).toHaveCount(0);
  await expect(page.getByText(/未產生入場參考價/)).toBeVisible();
  await expect(page.getByText(/避開 \/ 賣出|強烈建議買入/)).toHaveCount(0);
  await noOverflow(page);
});

test("untriggered setups display waiting and observed weak reward-risk displays failure", async ({ page, request }) => {
  const report = await strategyFixture(request);
  report.candlesDaily[199].volume = 1000;
  refreshStrategyFixture(report);
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await expect(page.getByTestId("technical-strategy")).toContainText("技術策略：等待觸發");
  await expect(page.getByTestId("reference-plan")).toContainText("觀察參考價（目前未符合入場條件）");
  report.candlesDaily[180].high = report.candlesDaily[180].close + 0.2;
  refreshStrategyFixture(report);
  await page.reload();
  await expect(page.getByTestId("technical-strategy")).toContainText("技術策略：條件不符合");
  await expect(page.getByTestId("technical-strategy")).toContainText("未達標 · 毛風險回報");
  await noOverflow(page);
});

test("unknown quote fields cannot look like unchanged prices or zero volume", async ({ page, request }) => {
  const response = await request.get("http://127.0.0.1:3050/api/report?symbol=AAPL");
  const report = await response.json();
  report.mode = "real";
  Object.assign(report.quote, { change: null, changePct: null, volume: null, timestamp: null, asOf: null, fetchedAt: 1792368000, isRealTime: null });
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await expect(page.getByText("漲跌未知 (百分比未知)", { exact: true })).toBeVisible();
  await expect(page.getByText("成交量 未知", { exact: true })).toBeVisible();
  await expect(page.getByText(/供應商報價時間：未知；即時／延遲狀態：未知/)).toBeVisible();
  await expect(page.getByText(/不是成交時間/)).toBeVisible();
  await noOverflow(page);
});

test("paused news is clearly separate from stock data and model reference prices", async ({ page, request }) => {
  const response = await request.get("http://127.0.0.1:3050/api/report?symbol=AAPL");
  const report = await response.json();
  report.mode = "real";
  report.news = [];
  report.newsStatus = "disabled";
  report.sources.news = "unknown";
  report.newsMessage = "新聞功能暫停，未請求外部新聞來源。";
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await reportReady(page);
  await expect(page.getByText(report.newsMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往 Google News 查看相關新聞" })).toHaveCount(0);
  await expect(page.getByText(/並非分析師目標價；未經費用及樣本外回測驗證/)).toBeVisible();
  await expect(page.getByText(/以下為一般研究框架/)).toBeVisible();
  await noOverflow(page);
});

test("financial details distinguish missing EPS from net-income growth and preserve real zero", async ({ page, request }) => {
  const response = await request.get("http://127.0.0.1:3050/api/report?symbol=AAPL");
  const report = await response.json();
  report.financials = { ...report.financials, epsGrowth: null, netIncomeGrowth: 25, grossMargin: 0, roic: null,
    notes: { epsGrowth: "EPS 未披露，不以淨利增長代替。", roic: "缺少稅務資料，不假設稅率。" } };
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  await page.getByText("財務數值與缺失說明", { exact: true }).click();
  await expect(page.getByText("EPS 增長：未知／不適用", { exact: true })).toBeVisible();
  await expect(page.getByText("淨利增長（不是 EPS）：25%", { exact: true })).toBeVisible();
  await expect(page.getByText("毛利率：0%", { exact: true })).toBeVisible();
  await expect(page.getByText("簡化 ROIC（推導）：未知／不適用", { exact: true })).toBeVisible();
  await expect(page.getByText("缺少稅務資料，不假設稅率。", { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("Google news displays its publisher, time, source badge and safe external link", async ({ page, request }) => {
  const response = await request.get("http://127.0.0.1:3050/api/report?symbol=AAPL");
  expect(response.ok()).toBe(true);
  const report = await response.json();
  report.mode = "real";
  report.sources.news = "google_news";
  report.newsStatus = "ready";
  report.newsMessage = "Google News 最近七日搜尋結果；連結經 Google 跳轉至原文。";
  report.news = [{ title: "Google acceptance headline", source: "Test Publisher", time: 1792324800, url: "https://example.com/news", summary: "" }];
  await page.route("**/api/report?**", route => route.fulfill({ json: report }));
  await page.goto("/stock/AAPL");
  const link = page.getByRole("link", { name: "Google acceptance headline" });
  await expect(link).toHaveAttribute("href", "https://example.com/news");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByText("新聞·Google News RSS", { exact: true })).toBeVisible();
  await expect(page.getByText(/Test Publisher ·/)).toBeVisible();
  await expect(page.getByText(report.newsMessage, { exact: true })).toBeVisible();
  await noOverflow(page);
});

async function reportReady(page: Page) {
  await expect(page.getByRole("heading", { name: /報價頭/ })).toBeVisible();
  await expect(page.locator("section")).toHaveCount(11);
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.width + 1);
}

for (const status of ["empty", "unavailable"] as const) {
  test(`news ${status} is clearly labelled without hiding the stock report`, async ({ page, request }) => {
    const response = await request.get("http://127.0.0.1:3050/api/report?symbol=AAPL");
    const report = await response.json();
    report.mode = "real";
    report.news = [];
    report.newsStatus = status;
    report.sources.news = status === "empty" ? "google_news" : "unknown";
    report.newsMessage = status === "empty" ? "Google News 最近七日沒有可顯示的相關新聞。" : "Google 新聞讀取失敗或格式無效，請稍後再試";
    await page.route("**/api/report?**", route => route.fulfill({ json: report }));
    await page.goto("/stock/AAPL");
    await reportReady(page);
    await expect(page.getByText(report.newsMessage, { exact: true })).toBeVisible();
    await expect(page.getByText(status === "empty" ? "新聞·Google News RSS" : "新聞·未知 / 未取得", { exact: true })).toBeVisible();
    const fallback = page.getByRole("link", { name: "前往 Google News 查看相關新聞" });
    if (status === "unavailable") {
      await expect(fallback).toHaveAttribute("href", /https:\/\/news\.google\.com\/search\?q=AAPL/);
      await expect(fallback).toHaveAttribute("target", "_blank");
      await expect(fallback).toHaveAttribute("rel", "noopener noreferrer");
    } else await expect(fallback).toHaveCount(0);
    await noOverflow(page);
  });
}

for (const input of ["AAPL", " us.aapl ", "MSFT", "TSLA"]) {
  test(`keyboard search normalizes ${JSON.stringify(input)} and opens a working report`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("combobox").fill(input);
    await page.getByRole("combobox").press("Enter");
    await expect(page).toHaveURL(new RegExp(`/stock/${input.trim().toUpperCase().replace(/^US\./, "")}$`));
    await reportReady(page);
  });
}

test("company name search fetches no report until a result is selected", async ({ page }) => {
  let reports = 0;
  page.on("request", request => { if (request.url().includes("/api/report?")) reports++; });
  await page.goto("/");
  await page.getByRole("combobox").fill("Microsoft");
  const result = page.getByRole("button", { name: /US\.MSFT/ });
  await expect(result).toBeVisible();
  expect(reports).toBe(0);
  await result.click();
  await expect(page).toHaveURL(/\/stock\/MSFT$/);
  await reportReady(page);
  expect(reports).toBeGreaterThan(0);
});

test("no matching company is distinct from a search service failure", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox").fill("NoSuchCorporationXyz");
  await expect(page.getByText(/找不到符合範圍的股票/)).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("search failure is actionable and cannot navigate to a fabricated stock", async ({ page }) => {
  await page.route("**/api/search?**", route => route.fulfill({ status: 503, json: { error: "股票搜尋服務暫時不可用，請稍後再試", code: "DATA_UNAVAILABLE" } }));
  await page.goto("/");
  await page.getByRole("combobox").fill("Microsoft");
  await page.getByRole("combobox").press("Enter");
  await expect(page.getByText("股票搜尋服務暫時不可用，請稍後再試", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("clearing a submitted search prevents late navigation", async ({ page }) => {
  let release!: () => void;
  let delivered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const complete = new Promise<void>(resolve => { delivered = resolve; });
  await page.route("**/api/search?**", async route => {
    await pending;
    try { await route.fulfill({ json: { mode: "real", source: "nasdaq", data: [{ symbol: "US.MSFT", name: "Microsoft", type: "STOCK" }] } }); }
    finally { delivered(); }
  });
  await page.goto("/");
  await page.getByRole("combobox").fill("Microsoft");
  const request = page.waitForRequest("**/api/search?**");
  await page.getByRole("combobox").press("Enter");
  await request;
  await page.getByRole("combobox").fill("");
  release(); await complete;
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("search suggestion opens report, both charts paint candles, and layouts stay within the viewport", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("combobox").fill("AAPL");
  await page.getByRole("button", { name: /US\.AAPL/ }).click();
  await reportReady(page);
  if (info.project.name.startsWith("demo")) await expect(page.getByText(/示範模式：報價/)).toBeVisible();
  else await expect(page.getByText(/新聞·(?:Google News RSS|未知 \/ 未取得)/)).toBeVisible();
  for (const title of [/買入理由區/, /^10\.\s*日線圖/]) {
    const chart = page.locator("section").filter({ has: page.getByRole("heading", { name: title }) });
    await expect(chart.locator("canvas").first()).toBeVisible();
    await expect.poll(async () => chart.locator("canvas").evaluateAll(elements => {
      let colored = 0;
      for (const element of elements) {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("2d");
        if (!context) continue;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if ((pixels[i] === 34 && pixels[i + 1] === 197 && pixels[i + 2] === 94)
            || (pixels[i] === 239 && pixels[i + 1] === 68 && pixels[i + 2] === 68)) colored++;
        }
      }
      return colored;
    })).toBeGreaterThan(50);
  }
  await noOverflow(page);
  await page.getByText(/點此查看每個數據的詳細出處/).click();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("report.png"), fullPage: true });
  await info.attach("rendered report", { path: info.outputPath("report.png"), contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("invalid input gives an immediate message without navigating", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox").fill("BAD_SYMBOL");
  await page.getByRole("combobox").press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "搜尋內容無效，請輸入股票代號或公司名稱（最多 100 字）" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("permanent report errors are shown without repeating an invalid request", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/report?**", async route => {
    requests++;
    await route.fulfill({ status: 404, json: { error: "找不到股票代號", code: "SYMBOL_NOT_FOUND" } });
  });
  await page.goto("/stock/ZZZZZZ");
  await expect(page.getByText("找不到股票代號", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("provider failures display a useful report error instead of fabricated data", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/report?**", route => {
    requests++;
    return route.fulfill({ status: 503, json: { error: "行情服務暫時不可用，無法驗證股票代號", code: "DATA_UNAVAILABLE" } });
  });
  await page.goto("/stock/AAPL");
  await expect(page.getByText("行情服務暫時不可用，無法驗證股票代號", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(requests).toBe(2);
});

test("clearing or dismissing a pending search cannot reopen old suggestions", async ({ page }) => {
  let release!: () => void;
  let delivered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const complete = new Promise<void>(resolve => { delivered = resolve; });
  await page.route("**/api/search?**", async route => {
    await pending;
    try { await route.fulfill({ json: { mode: "demo", source: "mock", data: [{ symbol: "US.AAPL", name: "Apple", type: "STOCK" }] } }); }
    finally { delivered(); }
  });
  await page.goto("/");
  const request = page.waitForRequest("**/api/search?**");
  await page.getByRole("combobox").fill("AAPL");
  await request;
  await page.getByRole("combobox").fill("");
  await page.getByRole("heading", { name: "即時美股分析助手" }).click();
  release(); await complete;
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});
