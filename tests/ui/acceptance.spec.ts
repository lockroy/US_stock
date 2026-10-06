import { test, expect, type Page } from "@playwright/test";

async function reportReady(page: Page) {
  await expect(page.getByRole("heading", { name: /報價頭/ })).toBeVisible();
  await expect(page.locator("section")).toHaveCount(11);
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.width + 1);
}

for (const input of ["AAPL", " us.aapl "]) {
  test(`keyboard search normalizes ${JSON.stringify(input)} and opens a working report`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("combobox").fill(input);
    await page.getByRole("combobox").press("Enter");
    await expect(page).toHaveURL(/\/stock\/AAPL$/);
    await reportReady(page);
  });
}

test("search suggestion opens report, both charts paint candles, and layouts stay within the viewport", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("combobox").fill("AAPL");
  await page.getByRole("button", { name: /US\.AAPL/ }).click();
  await reportReady(page);
  if (info.project.name.startsWith("demo")) await expect(page.getByText(/示範模式：報價/)).toBeVisible();
  else await expect(page.getByText("新聞·未知 / 未取得", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("alert").filter({ hasText: "請輸入有效股票代號或選擇搜尋結果" })).toBeVisible();
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
