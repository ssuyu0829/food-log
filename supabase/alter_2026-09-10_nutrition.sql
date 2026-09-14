-- ============================================================
-- 2026-09-10 營養維度擴充 ＋ 體重 ＋ 手搖配方
-- 用法：Supabase → SQL Editor → New query → 整份貼上 → Run
-- 可重複執行（全部 if not exists）。
--
-- ⚠️ 這份**包含了 2026-09-09 那份還沒跑過的 alter**（meal_items.excluded /
--    meals.tg_reply_message_id）。2026-09-10 查詢 meal_items.excluded 回 42703，
--    確認 9/9 的 SQL 從來沒被執行過。跑這一份就一次補齊，不用再跑 alter_2026-09-09。
--
-- ⚠️ 順序不能反：**先跑這份 SQL，再部署 Edge Functions。**
--    反過來的話中間每一筆記錄都會寫失敗。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 補上 2026-09-09 沒跑到的兩欄
-- ------------------------------------------------------------
alter table meal_items add column if not exists excluded boolean not null default false;
alter table meals      add column if not exists tg_reply_message_id bigint;
create index if not exists meals_tg_reply_idx on meals (tg_reply_message_id)
  where deleted_at is null;

-- ------------------------------------------------------------
-- 1. 五個新的營養維度
--
-- ⚠️ 一律**允許 NULL，不給 default 0**。
--    NULL = 這筆沒量過（2026-09-10 之前的 33 筆全部是這種）
--    0    = 量過，答案是零
--    報表要分得出這兩者，所以不要在查詢裡 coalesce(...,0) 就當數字用——
--    那會讓 9/3–9/9 的舊資料看起來「鈉是 0」，是最容易誤導自己的一種錯。
--
-- ⚠️ sugar_g 的語意**沒有改**，仍然是「總糖」（含乳糖與水果自帶的果糖）。
--    added_sugar_g 才是 WHO 說的那個「游離糖／添加糖」，門檻 <50g/天 要對這一欄。
--    2026-09-10 之前的紀錄平均糖 77g/天 之所以嚇人，就是因為混了鮮奶茶的乳糖。
-- ------------------------------------------------------------
alter table meals add column if not exists sodium_mg     numeric;  -- 鈉 mg
alter table meals add column if not exists fiber_g       numeric;  -- 膳食纖維 g
alter table meals add column if not exists sat_fat_g     numeric;  -- 飽和脂肪 g
alter table meals add column if not exists added_sugar_g numeric;  -- 添加糖／游離糖 g
alter table meals add column if not exists veg_servings  numeric;  -- 蔬菜份數（1 份 ≈ 熟半碗／生一碗）

-- meal_items 也要同樣五欄，否則「✂️ 挑掉某一項」時鈉與蔬菜份數扣不掉
alter table meal_items add column if not exists sodium_mg     numeric;
alter table meal_items add column if not exists fiber_g       numeric;
alter table meal_items add column if not exists sat_fat_g     numeric;
alter table meal_items add column if not exists added_sugar_g numeric;
alter table meal_items add column if not exists veg_servings  numeric;

-- ------------------------------------------------------------
-- 2. 手搖配方（給 _shared/drink_model.ts 用）
--
--    原本 drinks 存的是六個「算好的」扁平欄位，結果同一杯的 kcal 與糖
--    各自隱含不同的鮮奶量（鮮奶茶 L：222 kcal ⇒ 352ml，但 20g 乳糖 ⇒ 425ml）。
--    改成存配方，kcal 與糖從同一個 milk_ratio 推出來，內部就不可能再打架。
--    扁平欄位仍然由模型產生並寫回，所以 PWA 與 report function 不用改。
-- ------------------------------------------------------------
alter table drinks add column if not exists recipe jsonb;

-- ------------------------------------------------------------
-- 3. 體重
--
--    為什麼放在 food-log 而不是 time-control（那邊才是「身體事件」）：
--    體重是熱量估計**唯一的外部校準錨**，要跟攝取量在同一個系統裡才自動對得起來。
--    這是 2026-09-10 對 personal/NOW.md 分工界線的一條修訂，不是就地各改。
-- ------------------------------------------------------------
create table if not exists weights (
  id          bigserial primary key,
  measured_at timestamptz not null default now(),
  kg          numeric not null check (kg > 20 and kg < 300),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists weights_measured_idx on weights (measured_at desc);

alter table weights enable row level security;  -- 一律關門，只走 service_role

-- 新表要重新 GRANT。RLS 擋政策、GRANT 擋權限，是不同層——
-- 2026-09-04 就是漏了這步讓 Edge Function 吃 42501。
grant select, insert, update, delete on weights to service_role;
grant usage, select on sequence weights_id_seq to service_role;

-- ------------------------------------------------------------
-- 驗收：這句要回 **17 列**
--   meals 6（5 個營養欄 ＋ tg_reply_message_id）
--   meal_items 6（5 個營養欄 ＋ excluded）
--   drinks 1（recipe）
--   weights 4（id / measured_at / kg / note）
-- 回比較少就是有哪一段沒跑成功。
-- ------------------------------------------------------------
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name in ('meals','meal_items')
      and column_name in ('sodium_mg','fiber_g','sat_fat_g','added_sugar_g','veg_servings',
                          'excluded','tg_reply_message_id'))
    or (table_name = 'drinks'  and column_name = 'recipe')
    or (table_name = 'weights' and column_name in ('id','measured_at','kg','note'))
  )
order by table_name, column_name;
