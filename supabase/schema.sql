-- ============================================================
-- food-log 資料庫結構
-- 用法：Supabase → SQL Editor → New query → 整份貼上 → Run
-- 這份可以重複執行（全部 IF NOT EXISTS / CREATE OR REPLACE）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 設定（key/value）
-- ------------------------------------------------------------
create table if not exists settings (
  key   text primary key,
  value text not null,
  note  text
);

-- 時區與日界線不在這裡設，寫死在 functions/_shared/stats.ts（TZ、DAY_START_HOUR）。
-- 要改的話看 README 的「在地化」一節。
insert into settings (key, value, note) values
  ('daily_kcal_target', '',            '每日熱量目標；空字串＝不設目標，只報數字不評價'),
  ('weekly_drink_limit','',            '每週手搖杯數上限；空字串＝不設'),
  ('tg_chat_id',        '',            'Bot 只回應這個 chat_id。設定前 Bot 會告訴你你的 id'),
  ('pwa_url',           '',            '/app 指令回傳的網址。⚠️ 一定要連 ?t=<PWA_TOKEN> 一起填，只填網域會讓手機打開後卡在「還沒認證」，而唯一拿 token 的管道就是 /app，會繞成死結')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2. 手搖／飲料熱量表
--    設計說明：不展開「甜度 × 容量」的組合（那會變成 10 倍的列數且難維護），
--    改存「不含糖熱量」與「全糖時的糖克數」，實際熱量在查詢時算：
--        kcal    = base_kcal    + sugar_g_full * 甜度係數 * 4
--        sugar_g = base_sugar_g + sugar_g_full * 甜度係數
--    base_kcal 已含配料與奶的熱量（含它們自帶的糖），base_sugar_g 是那部分的糖，
--    所以你點「無糖珍奶」時糖量不會顯示成 0——珍珠本身就是糖。
--    甜度係數：無糖 0 / 微糖 0.15 / 半糖 0.5 / 少糖 0.7 / 全糖 1.0
--    沒指定甜度時當無糖；沒指定杯型時當大杯（只有明確講中／小杯才算 M）。
-- ------------------------------------------------------------
create table if not exists drinks (
  id              bigserial primary key,
  brand           text not null,
  item            text not null,
  aliases         text[] not null default '{}',
  base_kcal_m     numeric not null,   -- 中杯(約500cc) 不含糖的熱量
  base_kcal_l     numeric not null,   -- 大杯(約700cc) 不含糖的熱量
  sugar_g_full_m  numeric not null,   -- 中杯「糖水」全糖時的糖克數（可調）
  sugar_g_full_l  numeric not null,   -- 大杯「糖水」全糖時的糖克數（可調）
  base_sugar_g_m  numeric not null default 0,  -- 中杯配料/鮮奶自帶的糖（不隨甜度變）
  base_sugar_g_l  numeric not null default 0,  -- 大杯配料/鮮奶自帶的糖（不隨甜度變）
  source_type     text not null default 'estimated'
                  check (source_type in ('official','searched','estimated')),
  source_url      text,
  updated_at      timestamptz not null default now(),
  unique (brand, item)
);

create index if not exists drinks_brand_idx on drinks (brand);

-- ⚠️ 2026-09-10 追加。原本 drinks 只存六個「算好的」扁平欄位，結果同一杯的
--    kcal 與糖各自隱含不同的鮮奶量（鮮奶茶 L：222 kcal ⇒ 352ml，20g 乳糖 ⇒ 425ml，差 20%）。
--    改成存配方，兩者從同一個 milk_ratio 推出來就不可能再打架。
--    扁平欄位仍由 supabase/build_drinks.ts 產生並寫回，所以下游全部不用改。
alter table drinks add column if not exists recipe jsonb;

-- 甜度字串 → 係數。
--   沒講（null／空字串）＝無糖，因為使用者的常態就是無糖。
--   有講但看不懂的字串＝全糖（寧可高估，不要低估）。
create or replace function sweetness_factor(s text)
returns numeric language sql immutable as $$
  select case
    when s is null or btrim(s) = '' then 0.0
    when s ~ '無糖|去糖|不加糖|零糖|0分|完全不加' then 0.0
    when s ~ '微糖|一分|1分|10%'                  then 0.15
    when s ~ '二分|2分|20%'                       then 0.2
    when s ~ '三分|3分|30%'                       then 0.3
    when s ~ '半糖|五分|5分|50%'                  then 0.5
    when s ~ '少糖|七分|7分|70%'                  then 0.7
    when s ~ '八分|8分|80%'                       then 0.8
    when s ~ '全糖|正常糖|100%'                   then 1.0
    else 1.0
  end;
$$;

-- 算一杯飲料的熱量與糖量
create or replace function drink_nutrition(
  p_drink_id bigint, p_size text, p_sweetness text
) returns table (kcal numeric, sugar_g numeric)
language sql stable as $$
  select
    round(
      case when p_size = 'M' then d.base_kcal_m else d.base_kcal_l end
      + (case when p_size = 'M' then d.sugar_g_full_m else d.sugar_g_full_l end)
        * sweetness_factor(p_sweetness) * 4
    ),
    round(
      (case when p_size = 'M' then d.base_sugar_g_m else d.base_sugar_g_l end)
      + (case when p_size = 'M' then d.sugar_g_full_m else d.sugar_g_full_l end)
        * sweetness_factor(p_sweetness), 1
    )
  from drinks d where d.id = p_drink_id;
$$;

-- ------------------------------------------------------------
-- 3. 飲食記錄
-- ------------------------------------------------------------
create table if not exists meals (
  id                 bigserial primary key,
  eaten_at           timestamptz not null default now(),
  source             text not null check (source in ('photo','text','drink')),
  title              text,               -- 一行摘要，例如「雞腿便當」「50嵐 四季春 微糖 L」
  raw_text           text,               -- 你原本打的字
  photo_path         text,               -- Supabase Storage 的路徑
  total_kcal         numeric,
  protein_g          numeric,
  fat_g              numeric,
  carb_g             numeric,
  sugar_g            numeric,
  confidence         text check (confidence in ('high','medium','low')),
  estimate_note      text,               -- 「這杯是估的」之類要對你誠實講的話
  model              text,               -- 用哪個模型算的，或 'drinks-table'
  portion_multiplier numeric not null default 1,
  is_drink           boolean not null default false,
  drink_id           bigint references drinks(id),
  tg_chat_id         bigint,
  tg_message_id      bigint,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists meals_eaten_at_idx on meals (eaten_at desc)
  where deleted_at is null;

create table if not exists meal_items (
  id        bigserial primary key,
  meal_id   bigint not null references meals(id) on delete cascade,
  name      text not null,
  qty_desc  text,
  kcal      numeric,
  protein_g numeric,
  fat_g     numeric,
  carb_g    numeric,
  sugar_g   numeric,
  ord       int not null default 0
);

create index if not exists meal_items_meal_idx on meal_items (meal_id);

-- ⚠️ 2026-09-09 追加的欄位。`create table if not exists` 對「已經存在的表」什麼都不做，
-- 所以新欄位一定要用 alter 才會同時服務「從零重建」與「線上這一份」。
--
-- meal_items.excluded：拍到別人的食物時把那一項挑掉。軟排除、不刪列，所以按回來就回來了。
--   總熱量一律從「未排除的細項」重算（見 _shared/meal.ts 的 recalcMeal）。
alter table meal_items add column if not exists excluded boolean not null default false;

-- meals.tg_reply_message_id：bot 那則「記好了」訊息的 id。
--   使用者回覆它並打一個數字＝自訂份量倍率，靠這一欄對回是哪一筆。
alter table meals add column if not exists tg_reply_message_id bigint;
create index if not exists meals_tg_reply_idx on meals (tg_reply_message_id)
  where deleted_at is null;

-- ⚠️ 2026-09-10 追加的五個營養維度。**允許 NULL，不給 default 0**：
--    NULL = 沒量過（9/10 之前的紀錄全部是這種）、0 = 量過答案是零。
--    報表要分得出這兩者，不要 coalesce(...,0) 就當數字用——
--    那會讓舊資料看起來「鈉是 0」，是最容易誤導自己的一種錯。
--
-- ⚠️ sugar_g 的語意沒有改，仍然是**總糖**（含乳糖與水果的果糖）。
--    added_sugar_g 才是 WHO 的「游離糖」，<50g/天 的門檻要對這一欄。
alter table meals add column if not exists sodium_mg     numeric;
alter table meals add column if not exists fiber_g       numeric;
alter table meals add column if not exists sat_fat_g     numeric;
alter table meals add column if not exists added_sugar_g numeric;
alter table meals add column if not exists veg_servings  numeric;

-- meal_items 也要，否則「✂️ 挑掉某一項」時鈉與蔬菜份數扣不掉
alter table meal_items add column if not exists sodium_mg     numeric;
alter table meal_items add column if not exists fiber_g       numeric;
alter table meal_items add column if not exists sat_fat_g     numeric;
alter table meal_items add column if not exists added_sugar_g numeric;
alter table meal_items add column if not exists veg_servings  numeric;

-- ------------------------------------------------------------
-- 3b. 體重
--     放在 food-log 而不是 time-control（那邊才是「身體事件」）的理由：
--     體重是熱量估計**唯一的外部校準錨**，要跟攝取量在同一個系統裡
--     才自動對得起來。這是 2026-09-10 對 personal/NOW.md 分工界線的一條修訂。
-- ------------------------------------------------------------
create table if not exists weights (
  id          bigserial primary key,
  measured_at timestamptz not null default now(),
  kg          numeric not null check (kg > 20 and kg < 300),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists weights_measured_idx on weights (measured_at desc);

-- ------------------------------------------------------------
-- 4. PWA 讀取用的 token
-- ------------------------------------------------------------
create table if not exists report_token (
  token      text primary key default encode(gen_random_bytes(16), 'hex'),
  label      text,
  created_at timestamptz not null default now()
);

insert into report_token (label)
select '我的手機'
where not exists (select 1 from report_token);

-- ------------------------------------------------------------
-- 5. RLS：一律關門。所有存取都走 Edge Function（service_role）
-- ------------------------------------------------------------
alter table settings     enable row level security;
alter table drinks       enable row level security;
alter table meals        enable row level security;
alter table meal_items   enable row level security;
alter table report_token enable row level security;
alter table weights      enable row level security;
-- 不建任何 policy＝anon/authenticated 完全讀不到。
-- service_role 會繞過 RLS，所以 Edge Function 仍然可以讀寫。

-- ⚠️ 2026-09-04 實戰補上：RLS 擋的是「政策」，GRANT 擋的是「權限」，兩者是不同層。
-- 若建專案時關掉了「Automatically expose new tables」，這些表不會被 GRANT 給任何
-- Data API 角色，而 Edge Function 的 supabase-js 走的正是 Data API（PostgREST），
-- 於是 service_role 會吃到 42501 permission denied，bot 整個不會動。
-- 只授權 service_role，anon/authenticated 一律不給，安全性沒有放寬。
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- ------------------------------------------------------------
-- 6. 照片儲存桶（private）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 印出你的 PWA token
-- ------------------------------------------------------------
select token as "PWA token（等 PWA 上線後接在網址 ?t= 後面）" from report_token;
