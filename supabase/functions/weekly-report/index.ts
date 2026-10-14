// 每週報告。建議週日晚上跑。
// 部署：supabase functions deploy weekly-report
import { getSetting } from "../_shared/db.ts";
import { sendMessage } from "../_shared/telegram.ts";
import { weekReport } from "../_shared/format.ts";
import { lastNDays, mealsBetween, proteinTargetG } from "../_shared/stats.ts";

Deno.serve(async () => {
  const chatId = Number(await getSetting("tg_chat_id"));
  if (!chatId) return new Response("尚未綁定 tg_chat_id", { status: 200 });

  const [s, e, days] = lastNDays(7);
  const rows = await mealsBetween(s, e);
  const prevStart = new Date(new Date(s).getTime() - 7 * 86400000).toISOString();
  const prev = await mealsBetween(prevStart, s);

  const limit = Number(await getSetting("weekly_drink_limit")) || null;
  const body = weekReport(rows, days, prev, await proteinTargetG());
  const tail = limit ? `\n\n手搖上限 ${limit} 杯／週。` : "";

  await sendMessage(chatId, body + tail);
  return new Response("sent");
});
