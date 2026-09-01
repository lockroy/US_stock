# GitHub → Cloudflare Workers 部署詳盡指南

> 目標：把「即時美股分析助手」透過 GitHub 同步到 Cloudflare Workers 部署
> 版本：v0.4.0（已修復 build 死循環問題）

---

## 一、整體流程圖

```
本地專案 → GitHub 倉庫 → Cloudflare Workers（連 GitHub）→ 自動 build + deploy
                ↑                              ↓
            push 代碼                      每次 push 自動觸發
```

---

## 二、本次 v0.4.0 修復了什麼（重要背景）

之前 v0.3.0 部署失敗，根因是 `package.json` 的 `build` script 問題。關鍵概念：

> **OpenNext 的 `opennextjs-cloudflare build` 內部會呼叫 `npm run build`（即 `next build`）**。

所以：
- ✅ **`build` 必須保持 `next build`**（OpenNext 內部靠它做第一步）
- ❌ 如果把 `build` 改成 `opennextjs-cloudflare build`，會造成**死循環遞迴**（OpenNext 調 build → build 又調 OpenNext → ... 無限迴圈）

v0.4.0 已修正：
- `build` = `next build`（正確，供 OpenNext 內部調用）
- `cf:build` = `opennextjs-cloudflare build`（正確的完整構建入口）

---

## 三、部署平台的正確配置（關鍵）

你在 Cloudflare 部署時，需要設定兩個命令：

| 命令 | 填什麼 | 說明 |
|---|---|---|
| **Build command** | `npm run cf:build` | ⚠️ 不是 `npm run build`！要用 `cf:build` 才會生成 OpenNext 產物 |
| **Deploy command** | `npx wrangler deploy` | 會自動偵測 OpenNext 產物並部署 |

> **之前失敗的直接原因**：你平台設的 build 命令是 `npm run build`（= next build），它只做普通 Next 構建，**不生成 `.open-next/worker.js`**，所以 deploy 時報「Could not find compiled Open Next config」。

---

## 四、詳細步驟

### 第 1 步：本地解壓並初始化 Git

```bash
# 解壓 zip
unzip us-stock-analyzer-v0.4.0.zip
cd us-stock-analyzer

# 初始化 git（如果還沒）
git init
git add .
git commit -m "v0.4.0: 修復 build 死循環，OpenNext 部署就緒"
```

### 第 2 步：建立 GitHub 倉庫

1. 打開 https://github.com/new
2. 倉庫名填 `us-stock-analyzer`（或任意名）
3. **選 Private**（避免數據源配置外洩，雖然目前沒有敏感 key）
4. 不要勾選初始化 README（我們已有）
5. 點 Create repository

### 第 3 步：推送代碼到 GitHub

```bash
git remote add origin https://github.com/<你的用戶名>/us-stock-analyzer.git
git branch -M main
git push -u origin main
```

> 如果 push 要認證，用 GitHub CLI 登入：`gh auth login`，或生成 Personal Access Token。

### 第 4 步：Cloudflare 連接 GitHub

1. 登入 Cloudflare Dashboard（https://dash.cloudflare.com）
2. 左側選 **Workers & Pages**
3. 點 **Create** → **Pages** 標籤 → **Connect to Git**
4. 授權 GitHub，選你的 `us-stock-analyzer` 倉庫
5. 在設定頁面填寫：

| 欄位 | 值 |
|---|---|
| Framework preset | **Next.js**（或手動選） |
| Build command | `npm run cf:build` |
| Build output directory | 留空（OpenNext 會自動處理） |

> ⚠️ **這裡是關鍵**：Build command 一定要填 `npm run cf:build`，不是 `npm run build`。

### 第 5 步：設定環境變數

在 Cloudflare Pages 的 **Settings → Environment variables** 加：

| 變數 | 值 |
|---|---|
| `REAL_DATA` | `false`（先跑通流程用 mock；要真實數據設 true 但需 Paid） |

> 其他變數（FUTU_API_BASE、NEWS_PROVIDER）已在 `wrangler.jsonc` 的 `[vars]` 裡寫好，不用重複設。

### 第 6 步：觸發部署

- 第一次連接時會自動觸發
- 之後每次 `git push` 到 main 分支，都會自動重新部署

---

## 五、部署後驗證

部署成功後，會得到一個網址（類似 `https://us-stock-analyzer.<你的子域>.pages.dev`）。

1. 打開首頁 → 應該看到「即時美股分析助手」
2. 輸入 `AAPL` → 如果 `REAL_DATA=false`，會顯示 mock 數據（能跑通）
3. 如果 `REAL_DATA=true` 且是 Free 方案 → 會報 `Error 1102`（CPU 超時，這是預期的）

---

## 六、關鍵提醒（務必看）

1. **Build command 一定要用 `npm run cf:build`**，這是 v0.3.0 失敗的核心原因
2. **Workers Free 的 10ms CPU 上限**依然存在：
   - 跑通流程：`REAL_DATA=false`
   - 真實數據：需升 Workers Paid（$5/月）
3. **不要在 Cloudflare 用「Workers」頁籤，要用「Pages」頁籤**（Pages 才支援 Git 連接 + Next.js 框架）

---

## 七、如果還是失敗

把新的 build log 給我，我繼續幫你修。目前已知的坑都已在 v0.4.0 修好：
- ✅ peer 依賴衝突（react-query 版本）
- ✅ package-lock 不同步
- ✅ build 死循環（本次修復）

---

*v0.4.0，2026-09-01*
