# 飲食帳本（food-log）

[![CI](https://github.com/ssuyu0829/food-log/actions/workflows/ci.yml/badge.svg)](https://github.com/ssuyu0829/food-log/actions/workflows/ci.yml)

用 Telegram 記錄每天吃的東西，AI 估熱量，手機主畫面上的 PWA 看趨勢。
重點在**看得到自己的飲食趨勢**，特別是手搖飲。

**第一次設定 → 看 [`docs/設定說明.md`](docs/設定說明.md)**

想自己部署一份的話，先知道三件事：

- **一個部署＝一個人。** Bot 只綁一個 Telegram 帳號、PWA 只發一個 token。要給第二個人用就再部署一份。
- `pwa/config.js` 裡的 Supabase 網址**要換成你自己的**，設定說明步驟 7 會講。
- 授權是 MIT，見 [`LICENSE`](LICENSE)。

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

## 設計與驗證重點

- **讓估算內部一致**：手搖飲不再各自儲存熱量與糖量，而是從同一份配方參數推導；這修掉了同一杯鮮奶茶的兩個欄位隱含奶量相差約 20% 的問題。
- **不把相關性說成校準結果**：體重可幫忙反推能量收支，但無法分開 AI 高估、漏記與個人 TDEE 差異，因此資料不足時只報方向，不輸出看似精確的「高估百分比」。
- **把模型輸出當成不可信輸入**：Gemini 使用結構化 schema，解析後再檢查欄位關係（例如添加糖不能高於總糖）；來源則區分 `official`、`searched` 與 `estimated`。

## 開發方式

我負責定義問題與功能範圍、資料模型、估算口徑及驗證條件；多數實作程式碼由 Claude（AI coding assistant）產生，再由我審查、測試與修正。這個 repo 保留 CI 與測試，讓上述規則可以被重複驗證。

## 目錄

| 路徑 | 是什麼 |
|---|---|
| `supabase/schema.sql` | 資料表。**新裝只要跑這份＋下一份 seed**，可重複執行 |
| `supabase/seed_drinks.sql` | 手搖初始熱量表（**全部是推估值**，見檔頭聲明）。由 `build_drinks.ts` 產生，不要手改 |
| `supabase/alter_2026-09-09_*.sql`<br>`supabase/alter_2026-09-10_*.sql` | **升級用，新裝不要跑**。給 2026-09-10 之前就建好的資料庫補欄位；`schema.sql` 已包含同樣的內容 |
| `supabase/fix_grants.sql` | 救援用。Edge Function 吃到 `42501 permission denied` 時跑 |
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

# 跑完整測試（與 CI 相同；測試不會連線到這些假服務）
cd supabase/functions/_shared
SUPABASE_URL=http://localhost \
SUPABASE_SERVICE_ROLE_KEY=test \
TELEGRAM_BOT_TOKEN=test TELEGRAM_WEBHOOK_SECRET=test \
GEMINI_API_KEY=test REPORT_TOKEN=test TELEGRAM_CHAT_ID=1 \
deno test --allow-all

# 部署
supabase functions deploy telegram-webhook
git add -A && git commit -m "..." && git push          # PWA 走 GitHub Pages
```

## 熱量數字的可信度

- **照片辨識**：誤差約 ±25%。價值在趨勢，不是絕對值。
- **手搖**：`drinks` 表裡 `source_type` 欄位就是誠實標籤——
  `official` / `searched`（有來源網址）才是官方數字，`estimated` 是我用
  「基底 + 糖水 × 甜度」推估的。Bot 回覆時會講明是哪一種。
