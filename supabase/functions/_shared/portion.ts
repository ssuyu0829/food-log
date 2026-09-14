// ============================================================
// 份量與細項加總的純函式。
// 這支刻意「不 import db.ts」，所以測試不需要任何環境變數
// （既有的 drinks_test / day_test 都要靠 dummy env 才跑得起來，別再多一個）。
// ============================================================

export interface ItemLike {
  kcal?: number | string | null;
  protein_g?: number | string | null;
  fat_g?: number | string | null;
  carb_g?: number | string | null;
  sugar_g?: number | string | null;
  // 2026-09-10 加的五個維度。舊資料一律 null。
  sodium_mg?: number | string | null;
  fiber_g?: number | string | null;
  sat_fat_g?: number | string | null;
  added_sugar_g?: number | string | null;
  veg_servings?: number | string | null;
  excluded?: boolean | null;
}

export interface Macros {
  total_kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  sugar_g: number;
  // ⚠️ 這五個是 number | null，不是 number。null = 沒量過，0 = 量過是零。
  sodium_mg: number | null;
  fiber_g: number | null;
  sat_fat_g: number | null;
  added_sugar_g: number | null;
  veg_servings: number | null;
}

/**
 * 2026-09-10 加的五個維度，加總與縮放的規則跟前面五個不一樣，所以獨立成一張表。
 * dp = 小數位數。
 */
const NEW_FIELDS: { key: keyof ItemLike; out: keyof Macros; dp: number }[] = [
  { key: "sodium_mg",     out: "sodium_mg",     dp: 0 },
  { key: "fiber_g",       out: "fiber_g",       dp: 1 },
  { key: "sat_fat_g",     out: "sat_fat_g",     dp: 1 },
  { key: "added_sugar_g", out: "added_sugar_g", dp: 1 },
  { key: "veg_servings",  out: "veg_servings",  dp: 1 },
];

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const isNull = (v: unknown) => v === null || v === undefined || v === "";
const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** 未被挑掉的細項才算數。挑掉的列仍然留著，所以按回來就回來了。 */
export const kept = <T extends ItemLike>(items: T[]): T[] => items.filter((i) => !i.excluded);

/**
 * 把「未排除的細項」加總後乘上倍率。
 * 一律從細項的原始值重算，所以 ×2 → 挑掉一項 → ×0.5 這種任意順序都會回到正確數字。
 *
 * ⚠️ 五個新維度**沒有任何一項有值時回 null，不回 0**。
 *    2026-09-10 之前的 33 筆記錄沒有鈉/纖維/蔬菜資料，如果加總成 0 寫回資料庫，
 *    「沒量過」就永久變成「量過，答案是零」——報表會算出假的達標率。
 *    只要有一項有值，其餘 null 的當 0 加（那是「這項沒有鈉」的合理讀法）。
 */
export function sumItems(items: ItemLike[], mult: number): Macros {
  const list = kept(items);
  const s = (k: keyof ItemLike) => list.reduce((acc, i) => acc + n(i[k]), 0) * mult;

  const out: Macros = {
    total_kcal: Math.round(s("kcal")),
    protein_g: Math.round(s("protein_g")),
    fat_g: Math.round(s("fat_g")),
    carb_g: Math.round(s("carb_g")),
    sugar_g: round(s("sugar_g"), 1),
    sodium_mg: null, fiber_g: null, sat_fat_g: null,
    added_sugar_g: null, veg_servings: null,
  };
  for (const f of NEW_FIELDS) {
    const anyMeasured = list.some((i) => !isNull(i[f.key]));
    (out[f.out] as number | null) = anyMeasured ? round(s(f.key), f.dp) : null;
  }
  return out;
}

/**
 * 沒有任何細項時（Gemini 偶爾只回總量）的退路：
 * 按「舊倍率 → 新倍率」的比例縮放 meals 自己那幾欄。
 *
 * ⚠️ 這是在修一個既有的 bug：原本 telegram-webhook 的倍率鍵直接加總空陣列，
 * 這種筆一按倍率就會變成 0 kcal。
 *
 * ⚠️ 五個新維度原本是 null 就維持 null（同 sumItems 的理由）。
 */
export function scaleMacros(meal: ItemLike & Record<string, unknown>, ratio: number): Macros {
  const raw = (k: string) => (meal as Record<string, unknown>)[k];
  const g = (k: string) => n(raw(k));

  const out: Macros = {
    total_kcal: Math.round(g("total_kcal") * ratio),
    protein_g: Math.round(g("protein_g") * ratio),
    fat_g: Math.round(g("fat_g") * ratio),
    carb_g: Math.round(g("carb_g") * ratio),
    sugar_g: round(g("sugar_g") * ratio, 1),
    sodium_mg: null, fiber_g: null, sat_fat_g: null,
    added_sugar_g: null, veg_servings: null,
  };
  for (const f of NEW_FIELDS) {
    (out[f.out] as number | null) = isNull(raw(f.key as string))
      ? null
      : round(g(f.key as string) * ratio, f.dp);
  }
  return out;
}

export type PortionParse =
  | { kind: "ok"; value: number }
  | { kind: "out_of_range"; value: number }
  | null;

const FULLWIDTH = /[０-９．／]/g;
const toHalf = (s: string) =>
  s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * 「回覆那則訊息打一個數字」的解析。
 * 認得：0.7 / .5 / ×0.7 / x0.7 / *0.7 / 2/3 / 0.7倍 / 三分之二寫成 2/3。
 * 認不出來就回 null，呼叫端要原路往下走當成新的一筆記錄——
 * 否則「回覆某則訊息順手記另一樣東西」會被吃掉。
 */
export function parsePortion(raw: string): PortionParse {
  let s = toHalf((raw ?? "").trim());
  if (!s) return null;

  s = s.replace(/^[×✕✖xX*＊]\s*/, "").replace(/\s*(倍|份|人份)$/, "").trim();
  if (!s) return null;

  let value: number;
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    value = Number(frac[1]) / den;
  } else if (/^\d*\.?\d+$/.test(s)) {
    value = Number(s);
  } else {
    return null;
  }

  if (!Number.isFinite(value) || value <= 0) return null;
  value = Math.round(value * 100) / 100;
  // 超過 20 幾乎一定是想直接打熱量（350、1200…），不要照吞成 ×350
  if (value > 20) return { kind: "out_of_range", value };
  return { kind: "ok", value };
}
