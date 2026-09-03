-- ============================================================
-- 排程：每晚總結 + 每週報告
--
-- ⚠️ 這份檔案裡有兩個要換掉的地方，換完之後【不要 commit】。
--    要嘛直接在 Supabase SQL Editor 裡貼上執行，
--    要嘛另存成 supabase/cron.local.sql（已在 .gitignore 裡）。
--
-- ⚠️ pg_cron 的時間是 UTC，不是台北時間。
--    台北 21:30 = UTC 13:30　　台北週日 20:00 = UTC 週日 12:00
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 把下面兩個值換成你自己的（Supabase → Settings → API）
--   <PROJECT_REF>   例如 abcdefghijkl
--   <SERVICE_ROLE>  service_role 金鑰（很長那串）

select cron.unschedule('foodlog-daily')  where exists (select 1 from cron.job where jobname = 'foodlog-daily');
select cron.unschedule('foodlog-weekly') where exists (select 1 from cron.job where jobname = 'foodlog-weekly');

-- 每天台北 21:30
select cron.schedule('foodlog-daily', '30 13 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-summary',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE>", "Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 每週日台北 20:00
select cron.schedule('foodlog-weekly', '0 12 * * 0', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/weekly-report',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE>", "Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 確認排程建好了
select jobname, schedule, active from cron.job where jobname like 'foodlog%';
