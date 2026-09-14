-- ============================================================
-- 2026-09-09：挑掉細項 ＋ 自訂份量倍率
-- 用法：Supabase → SQL Editor → New query → 整份貼上 → Run（可重複執行）
--
-- 這兩段跟 schema.sql 裡的同名段落是同一份。獨立出來只是因為
-- schema.sql 那份會被「重建用」的情境跑，而線上這一份只需要跑這兩個 alter。
-- ============================================================

-- 拍到別人的食物時把那一項挑掉。軟排除、不刪列，所以按回來就回來了。
-- 總熱量一律從「未排除的細項」重算（_shared/meal.ts 的 recalcMeal）。
alter table meal_items add column if not exists excluded boolean not null default false;

-- bot 那則「記好了」訊息的 id。
-- 使用者回覆它並打一個數字＝自訂份量倍率，靠這一欄對回是哪一筆。
alter table meals add column if not exists tg_reply_message_id bigint;
create index if not exists meals_tg_reply_idx on meals (tg_reply_message_id)
  where deleted_at is null;

-- 跑完檢查一下（兩列都要出現）
select table_name, column_name
from information_schema.columns
where (table_name, column_name) in (('meal_items','excluded'), ('meals','tg_reply_message_id'));
