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

insert into settings (key, value, note) values
  ('tz',                'Asia/Taipei', '所有「今天」的判定基準時區'),
  ('daily_kcal_target', '',            '每日熱量目標；空字串＝不設目標，只報數字不評價'),
  ('weekly_drink_limit','',            '每週手搖杯數上限；空字串＝不設'),
  ('tg_chat_id',        '',            'Bot 只回應這個 chat_id。設定前 Bot 會告訴你你的 id'),
  ('pwa_url',           '',            '/app 指令回傳的網址')
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
-- 不建任何 policy＝anon/authenticated 完全讀不到。
-- service_role 會繞過 RLS，所以 Edge Function 仍然可以讀寫。

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
