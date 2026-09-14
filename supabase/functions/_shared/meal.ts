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
