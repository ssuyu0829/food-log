# 飲食帳本（food-log）

用 Telegram 記錄每天吃的東西，AI 估熱量，手機主畫面上的 PWA 看趨勢。
重點在**看得到自己的飲食趨勢**，特別是手搖飲。

**第一次設定 → 看 [`docs/設定說明.md`](docs/設定說明.md)**

```
Telegram（拍照／打字）
  └─ webhook ─▶ Supabase Edge Function
                  ├─ 照片 → Gemini vision → 逐項熱量
                  ├─ 手搖 → drinks 熱量表（查不到才上網搜）
                  └─ 存進 Postgres + Storage
                        ├─ report function ──▶ GitHub Pages PWA
                        └─ pg_cron ──▶ 每晚總結 / 每週報告
```

全部落在免費額度：Supabase free、Gemini free tier、Telegram、GitHub Pages。

## 目錄

| 路徑 | 是什麼 |
|---|---|
| `supabase/schema.sql` | 資料表。貼進 SQL Editor 執行 |
| `supabase/seed_drinks.sql` | 手搖初始熱量表（**全部是推估值**，見檔頭聲明） |
| `supabase/cron.sql` | 排程樣板。填了金鑰的版本不要 commit |
| `supabase/functions/_shared/gemini.ts` | **辨識引擎的唯一抽換點** |
| `supabase/functions/_shared/drinks.ts` | 手搖文字解析與熱量公式 |
| `supabase/functions/telegram-webhook/` | Bot 主邏輯 |
| `pwa/` | 前端。部署到 GitHub Pages |
| `dev/mock-server.ts` | 假資料伺服器，改前端時不用連 Supabase |

## 常用指令

```bash
# 本機看前端（假資料）
deno run --allow-net --allow-read dev/mock-server.ts   # → localhost:8788/?t=demo

# 測試
deno test --allow-env supabase/functions/_shared/drinks_test.ts

# 部署
supabase functions deploy telegram-webhook
git add -A && git commit -m "..." && git push          # PWA 走 GitHub Pages
```

## 熱量數字的可信度

- **照片辨識**：誤差約 ±25%。價值在趨勢，不是絕對值。
- **手搖**：`drinks` 表裡 `source_type` 欄位就是誠實標籤——
  `official` / `searched`（有來源網址）才是官方數字，`estimated` 是我用
  「基底 + 糖水 × 甜度」推估的。Bot 回覆時會講明是哪一種。
