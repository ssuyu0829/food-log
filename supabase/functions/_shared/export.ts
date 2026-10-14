// ============================================================
// 匯出：把記錄與體重變成 CSV。report function（PWA 下載）與 /export（Telegram 傳檔）共用。
//
// 為什麼要有：資料全在 Supabase 裡，沒有匯出就沒有備份，也沒辦法拿到試算表裡自己玩。
// ============================================================
import { db } from "./db.ts";
import { toCsv } from "./csv.ts";
import { lastNDays, logicalDate, TZ } from "./stats.ts";

/** 匯出最多回溯幾天。網頁報表是 90，匯出放寬到十年。 */
export const EXPORT_MAX_DAYS = 3650;

/** PostgREST 一次最多回 1000 列，超過要分頁。 */
const PAGE = 1000;

const fmtLocal = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
/** 2026-09-10 12:34（台北時間）。用 sv-SE 是因為它的格式剛好是 ISO 風格，排序不會亂。 */
export const localDateTime = (iso: string) => fmtLocal.format(new Date(iso));

const MEAL_HEADER = [
  "id", "吃的時間", "帳本日", "標題", "來源", "手搖",
  "kcal", "蛋白質g", "脂肪g", "碳水g", "總糖g",
  "鈉mg", "膳食纖維g", "飽和脂肪g", "添加糖g", "蔬菜份",
  "份量倍率", "把握度", "備註", "原始輸入", "模型",
];

async function fetchAll(q: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function mealsCsv(days: number): Promise<{ csv: string; count: number }> {
  const n = Math.min(EXPORT_MAX_DAYS, Math.max(1, days));
  const [s, e] = lastNDays(n);
  const rows = await fetchAll((from, to) =>
    db.from("meals").select("*").is("deleted_at", null)
      .gte("eaten_at", s).lt("eaten_at", e)
      .order("eaten_at", { ascending: true }).range(from, to));
  const cells = rows.map((r) => [
    r.id, localDateTime(r.eaten_at), logicalDate(new Date(r.eaten_at)), r.title, r.source, r.is_drink,
    r.total_kcal, r.protein_g, r.fat_g, r.carb_g, r.sugar_g,
    r.sodium_mg, r.fiber_g, r.sat_fat_g, r.added_sugar_g, r.veg_servings,
    r.portion_multiplier, r.confidence, r.estimate_note, r.raw_text, r.model,
  ]);
  return { csv: toCsv(MEAL_HEADER, cells), count: rows.length };
}

export async function weightsCsv(days: number): Promise<{ csv: string; count: number }> {
  const n = Math.min(EXPORT_MAX_DAYS, Math.max(1, days));
  const since = new Date(Date.now() - n * 86_400_000).toISOString();
  const rows = await fetchAll((from, to) =>
    db.from("weights").select("*").gte("measured_at", since)
      .order("measured_at", { ascending: true }).range(from, to));
  const cells = rows.map((r) => [r.id, localDateTime(r.measured_at), r.kg, r.note]);
  return { csv: toCsv(["id", "量測時間", "公斤", "備註"], cells), count: rows.length };
}

/** 檔名帶匯出日，重複匯出不會互相蓋掉 */
export const exportFilename = (kind: "meals" | "weights") =>
  `food-log-${kind}-${logicalDate()}.csv`;
