import { test, expect, type Page } from "@playwright/test";

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
