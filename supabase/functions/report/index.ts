// PWA 讀取用的唯一 API。用 ?t=<token> 認證。
// 前端不碰 Supabase，也就拿不到任何金鑰。
// 部署：supabase functions deploy report --no-verify-jwt
import { db, getSetting } from "../_shared/db.ts";
import { PHOTO_BUCKET } from "../_shared/env.ts";
import {
  completenessOf, groupByDay, lastNDays, logicalDate, mealsBetween, TARGETS, totalsOf,
} from "../_shared/stats.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 14)));

  const { data: t } = await db.from("report_token").select("token").eq("token", token).maybeSingle();
  if (!t) return json({ error: "無效的 token" }, 403);

  const [s, e, dayList] = lastNDays(days);
  const rows = await mealsBetween(s, e);
  const byDay = groupByDay(rows);

  // 照片給 1 小時有效的簽名網址（bucket 是 private）
  const paths = rows.map((r) => r.photo_path).filter(Boolean) as string[];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
  }

  return json({
    today: logicalDate(),
    target: Number(await getSetting("daily_kcal_target")) || null,
    drink_limit: Number(await getSetting("weekly_drink_limit")) || null,
    // 2026-09-10 起 totalsOf 自帶 sodium_mg / fiber_g / sat_fat_g / added_sugar_g /
    // veg_servings。**沒量過的是 null，前端不要 ?? 0**——那會讓舊資料顯示成「鈉 0」。
    targets: TARGETS,
    completeness: completenessOf(rows, dayList),
    days: dayList.map((d) => ({ date: d, ...totalsOf(byDay.get(d) ?? []) })),
    meals: rows.slice().reverse().map((r) => ({
      id: r.id, eaten_at: r.eaten_at, title: r.title,
      kcal: Number(r.total_kcal ?? 0), sugar_g: Number(r.sugar_g ?? 0),
      protein_g: Number(r.protein_g ?? 0), fat_g: Number(r.fat_g ?? 0), carb_g: Number(r.carb_g ?? 0),
      sodium_mg: r.sodium_mg, fiber_g: r.fiber_g, sat_fat_g: r.sat_fat_g,
      added_sugar_g: r.added_sugar_g, veg_servings: r.veg_servings,
      is_drink: r.is_drink, confidence: r.confidence, note: r.estimate_note,
      photo: r.photo_path ? signed.get(r.photo_path) ?? null : null,
    })),
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });
