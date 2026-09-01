# Cloudflare 部署速查（照抄即可）

## ⚠️ 最重要：你之前失败的 3 个根因

1. **项目类型错**：你建的是 **Pages**，但代码是 **Workers** 适配器
   → 改成 **Workers** 项目（不是 Pages）

2. **Build command 填错**：你填了 `npx wrangler deploy`
   → 这是「部署」命令，不是「构建」命令

3. **没生成 OpenNext 产物**：没有先 build 就 deploy
   → 必须先跑 `npm run cf:build`

---

## ✅ 正确配置（在 Cloudflare Workers 项目里照抄）

### 项目类型
- **Workers**（不是 Pages！）

### 连接方式
- Connect to Git → 选 `lockroy/US_stock`

### 两个命令（关键！）

| 字段 | 填这个 | 不要填 |
|---|---|---|
| **Build command** | `npm run cf:build` | ~~`npx wrangler deploy`~~ |
| **Deploy command** | `npx wrangler deploy` | — |

### 环境变量（Settings → Variables）

| 变量 | 值 | 说明 |
|---|---|---|
| `REAL_DATA` | `false` | 先跑通流程用 mock；真实数据需 Paid |

---

## 📋 完整流程（5 步）

```
1. GitHub 仓库已就绪（lockroy/US_stock，代码是 v0.4.0）
        ↓
2. Cloudflare → Workers & Pages → Create → Workers 标签
        ↓
3. Connect to Git → 选 US_stock 仓库
        ↓
4. 填命令：
   Build command   = npm run cf:build
   Deploy command  = npx wrangler deploy
        ↓
5. 环境变量 REAL_DATA=false → Deploy
        ↓
   ✅ 得到 .workers.dev 网址
```

---

## 🎯 判断是否成功的标志

构建日志里应该出现这一行（而不是报错）：

```
Worker saved in `.open-next/worker.js` 🚀
OpenNext build complete.
```

如果看到 `Could not find compiled Open Next config`，说明 **build command 还是没跑对**（还是 `npm run cf:build` 没执行成功）。

---

## 提醒

- **Workers Free 的 10ms CPU 上限**：跑通流程用 `REAL_DATA=false`，真实数据需升 Paid（$5/月）
- 以后每次 `git push` 到 main 分支会自动重新部署
