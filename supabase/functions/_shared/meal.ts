// ============================================================
// 一筆記錄的重算：倍率鍵、挑掉細項、回覆數字改份量，三條路徑共用這一支。
// 純算的部分在 portion.ts（不碰 db，測試不需要環境變數）。
// ============================================================
import { db } from "./db.ts";
import { type Macros, scaleMacros, sumItems } from "./portion.ts";

export interface ItemRow {
  id: number;
  meal_id: number;
  name: string;
  qty_desc: string | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  sugar_g: number | null;
  // 2026-09-10 加的五個維度。2026-09-10 之前的細項全是 null（沒量過）。
  sodium_mg: number | null;
  fiber_g: number | null;
  sat_fat_g: number | null;
  added_sugar_g: number | null;
  veg_servings: number | null;
  ord: number;
  excluded: boolean;
}

export async function getItems(mealId: number): Promise<ItemRow[]> {
  const { data } = await db.from("meal_items").select("*").eq("meal_id", mealId).order("ord");
  return (data ?? []) as ItemRow[];
}

/**
 * 從 meal_items 的原始值重算整筆並寫回 meals。
 * mult 沒給就沿用資料庫裡的 portion_multiplier（挑掉細項時走的就是這條）。
 */
export async function recalcMeal(
  mealId: number,
  mult?: number,
): Promise<{ meal: Record<string, any>; items: ItemRow[] } | null> {
  const { data: meal } = await db.from("meals").select("*").eq("id", mealId).single();
  if (!meal) return null;

  const oldMult = Number(meal.portion_multiplier ?? 1) || 1;
  const newMult = mult ?? oldMult;
  const items = await getItems(mealId);

  // 沒有任何細項的筆（Gemini 只回總量）不能用加總，否則會算成 0——照比例縮放
  const macros: Macros = items.length
    ? sumItems(items, newMult)
    : scaleMacros(meal, newMult / oldMult);

  const { data: updated, error } = await db.from("meals")
    .update({ portion_multiplier: newMult, ...macros })
    .eq("id", mealId).select().single();
  if (error) throw error;

  return { meal: updated, items };
}

/**
 * /again「再來一份」：把一筆記錄連同細項原樣複製成新的一筆，時間設現在。
 *
 * 直接複製 meals 上算好的欄位，不重算——那些欄位已經反映了倍率與挑掉的細項，
 * 所以「上次吃 0.7 份、挑掉別人那盤」再來一次還是同樣的數字。
 * 細項的 excluded 與 ord 一起帶過去，之後再按倍率鍵仍然算得對。
 * 照片沿用同一個 storage 路徑，不另存一份。
 */
const COPY_COLS = [
  "source", "title", "photo_path",
  "total_kcal", "protein_g", "fat_g", "carb_g", "sugar_g",
  "sodium_mg", "fiber_g", "sat_fat_g", "added_sugar_g", "veg_servings",
  "confidence", "estimate_note", "model", "portion_multiplier", "is_drink", "drink_id",
] as const;

export async function duplicateMeal(
  srcId: number,
  extra: { tg_chat_id: number; tg_message_id: number },
): Promise<Record<string, any> | null> {
  const { data: src } = await db.from("meals").select("*").eq("id", srcId).maybeSingle();
  if (!src) return null;

  const row: Record<string, unknown> = {};
  for (const k of COPY_COLS) row[k] = src[k] ?? null;

  const { data: meal, error } = await db.from("meals").insert({
    ...row,
    raw_text: `再來一份：${src.title ?? ""}`,
    eaten_at: new Date().toISOString(),
    ...extra,
  }).select().single();
  if (error) throw error;

  const items = await getItems(srcId);
  if (items.length) {
    const { error: e2 } = await db.from("meal_items").insert(
      items.map(({ id: _id, meal_id: _m, ...rest }) => ({ ...rest, meal_id: meal.id })),
    );
    if (e2) throw e2;
  }
  return meal;
}
