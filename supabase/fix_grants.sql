-- ============================================================
-- 修復：service_role 缺少 public schema 的資料表權限
-- ============================================================
-- 成因：建專案時取消勾選「Automatically expose new tables」，
-- 導致 schema.sql 建出來的表沒有 GRANT 給任何 Data API 角色，
-- 而 Edge Function 的 supabase-js 是走 PostgREST（Data API），
-- 所以 service_role 讀寫全部被擋（42501 permission denied）。
--
-- 注意：只授權給 service_role，anon/authenticated 一律不給。
-- RLS 仍然全開且無 policy，所以外部匿名請求照樣讀不到任何東西。
-- ============================================================

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public to service_role;

grant usage, select
  on all sequences in schema public to service_role;

-- 以後新增的表 / sequence 也自動有，不用再修一次
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- 確認：這五張表都要出現，且 privilege 有 SELECT/INSERT/UPDATE/DELETE
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where grantee = 'service_role' and table_schema = 'public'
group by table_name
order by table_name;
