# Cloudflare Workers 手動部署指南

> 目标：把「即時美股分析助手」部署到 Cloudflare Workers
> 适配方案：Next.js 16 + OpenNext Cloudflare 适配器（`@opennextjs/cloudflare`）
> 验证状态：✅ 已实测 `next build` 通过、`cf:build` 通过、单元测试通过

---

## ⚠️ 开始前必读（诚实告知）

你的选择是 **Workers Free 方案 + 升级 Next 16**。这里有一个**无法靠配置绕过的硬限制**：

| 项目 | Workers Free | 你的实际需求 | 结论 |
|---|---|---|---|
| CPU 时间 | **10 ms/request** | `/api/report` 要 5.6 秒 | 🔴 Free 必爆 |

**这意味着**：在 Free 方案下，`/api/report` 这个「实时拉 Nasdaq + 算 250 根 K 线指标」的接口**无法正常运行**，会报 `Error 1102: Worker exceeded resource limits`。

**两种务实解法（二选一）**：

### 解法 A：Free 也能跑 —— 设 `REAL_DATA=false`（纯 mock 模式）
把 `wrangler.jsonc` 里的 `"REAL_DATA": "false"`。这样不连 Nasdaq、不算真实指标，mock 数据在 10ms 内能跑完。**适合先验证部署流程通不通**。

### 解法 B：升级到 Workers Paid（$5/月）跑真实数据
在 Cloudflare 后台把方案从 Free 升到 Paid。Paid 默认 30 秒 CPU（可调到 5 分钟），足够跑真实数据。

---

## 我已完成的工作（你拿到 zip 时已经是这样）

1. ✅ `package.json`：Next 14.2.5 → **16.3.4**，React 18 → 19，加 `@opennextjs/cloudflare` + `wrangler`
2. ✅ `wrangler.jsonc`：按 OpenNext 官方模板写好（含 `nodejs_compat` + `global_fetch_strictly_public` + `WORKER_SELF_REFERENCE`）
3. ✅ `open-next.config.ts`：OpenNext 适配器配置
4. ✅ `public/_headers`：静态资源缓存头
5. ✅ `.dev.vars`：本地预览环境变量
6. ✅ `.gitignore`：加入 `.open-next`、`.wrangler`、`.dev.vars`
7. ✅ 修好 Next 15/16 的 `params` 破坏性变更（`app/stock/[symbol]/page.tsx`）
8. ✅ 修好 `Candle` 类型导出（`lib/indicators/indicators.ts`）
9. ✅ 实测 `next build` 成功、`npm test` 通过、`cf:build` 生成 worker.js 成功

---

## 部署步骤（按顺序执行）

### 第 1 步：安装依赖

```bash
cd us-stock-analyzer
npm install
```

> 因为我已经升级了 package.json，这一步会装 Next 16 + OpenNext + Wrangler。
> 如果你拿到的是已经含 node_modules 的完整目录，可跳过。

### 第 2 步：验证构建（可选但推荐）

```bash
npm run build          # 验证 Next 16 能编译
npm test               # 验证评分/指标逻辑
npm run cf:build       # 生成 Workers 产物 .open-next/worker.js
```

### 第 3 步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页，登录并授权即可。

### 第 4 步：部署

```bash
npm run cf:deploy
```

> 等价于 `opennextjs-cloudflare build && opennextjs-cloudflare deploy`

成功后返回 `https://us-stock-analyzer.<你的子域>.workers.dev`。

### 第 5 步（可选）：本地预览 Workers 运行时

```bash
npm run cf:preview
```

会在本地跑真实的 Workers 运行时（非 Node），访问它给的地址测试。

---

## 环境变量说明

| 变量 | 位置 | 说明 |
|---|---|---|
| `REAL_DATA` | wrangler.jsonc [vars] | true=真实 Nasdaq / false=mock（Free 建议 false） |
| `FUTU_API_BASE` | wrangler.jsonc [vars] | 富途 endpoint（Workers 上不可用，预留） |
| `NEWS_PROVIDER` | wrangler.jsonc [vars] | 新闻来源（finnhub） |
| `NEWS_API_KEY` | `npx wrangler secret put` | Finnhub key（接真实新闻时） |

**注意**：Workers 不读 `.env` 文件，环境变量要在 `wrangler.jsonc` 的 `[vars]` 或 `wrangler secret put` 里配置。

---

## 关键文件清单（本次打包）

| 文件 | 作用 | 状态 |
|---|---|---|
| `package.json` | Next 16 + OpenNext + cf 脚本 | ✅ 已升级并实测 |
| `wrangler.jsonc` | Workers 配置（官方模板对齐） | ✅ 新建 |
| `open-next.config.ts` | OpenNext 适配器配置 | ✅ 新建 |
| `public/_headers` | 静态资源缓存 | ✅ 新建 |
| `.dev.vars` | 本地预览变量 | ✅ 新建 |
| `.gitignore` | 排除构建产物 | ✅ 更新 |
| `.env.example` | 环境变量模板 | ✅ 更新 |
| `app/stock/[symbol]/page.tsx` | Next 16 params 修正 | ✅ 已修 |
| `lib/indicators/indicators.ts` | Candle 类型导出修正 | ✅ 已修 |
| `README.md` | 项目说明 + 部署章节 | ✅ 更新 |
| `DEPLOY-CLOUDFLARE-WORKERS.md` | 本部署指南 | ✅ 新建 |
| `CLOUDFLARE-WORKERS-部署前驗證.md` | 流程模拟 + 阻断点分析 | ✅ 已有 |

---

## 我的最终建议（重要，务必看）

**你的核心需求是「真实可见的数据 + 稳定部署」，Workers Free 无法同时满足两者。**

- 只想「跑通部署流程」：解法 A（`REAL_DATA=false`），Free 就能上。
- 想「真实数据 + 稳定」：**改回 Vercel（Hobby 免费）才是最优解**，`vercel.json` 已写好、Next 14 无需升级。
- 坚持 Workers 又要真实数据：升 Paid（$5/月）。

**本次打包默认 `REAL_DATA=true`**，你在 Free 上部署后 `/api/report` 会超时。请按上面解法二选一调整后再部署。

---

*验证基于 2026-09-01：Next 16.3.4、@opennextjs/cloudflare 1.20.5、wrangler 4.127.1。*
