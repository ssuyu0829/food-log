// 每晚推播當日總結。由 pg_cron 或 Supabase Scheduled Function 呼叫。
// 部署：supabase functions deploy daily-summary
import { getSetting } from "../_shared/db.ts";
import { sendMessage } from "../_shared/telegram.ts";
import { daySummary } from "../_shared/format.ts";
import { dayBounds, lastNDays, logicalDate, mealsBetween, totalsOf } from "../_shared/stats.ts";

Deno.serve(async () => {
  const chatId = Number(await getSetting("tg_chat_id"));
  if (!chatId) return new Response("尚未綁定 tg_chat_id", { status: 200 });

  const today = logicalDate();
  const [s, e] = dayBounds(today);
  const rows = await mealsBetween(s, e);
  const target = Number(await getSetting("daily_kcal_target")) || null;

  const parts = [daySummary(rows, target, "<b>今天的紀錄</b>")];

  // 手搖週上限：只在總結裡提一次，不在你記錄的當下念你
  const limit = Number(await getSetting("weekly_drink_limit")) || null;
  if (limit) {
    const [ws, we] = lastNDays(7);
    const week = totalsOf(await mealsBetween(ws, we));
    parts.push(week.drinkCount > limit
      ? `\n🥤 近 7 天 ${week.drinkCount} 杯，超過你設的 ${limit} 杯。`
      : `\n🥤 近 7 天 ${week.drinkCount} / ${limit} 杯。`);
  }

  if (rows.length === 0) parts.push("\n<i>今天一筆都沒記。現在補傳照片也算得進今天。</i>");

  await sendMessage(chatId, parts.join("\n"));
  return new Response("sent");
});
