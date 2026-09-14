// ============================================================
// 手搖飲的配方模型。**純函式，刻意不 import db.ts**
// （所以 drink_model_test.ts 不需要環境變數就能跑，比照 portion.ts）。
//
// 為什麼要有這一支
// ----------------
// 2026-09-10 之前，drinks 表存的是六個「已經算好」的扁平欄位，是人手打上去的。
// 結果同一杯的熱量與糖各自隱含不同的鮮奶量：
//   通用/鮮奶茶 大杯 = 230 kcal（扣掉茶 8 → 鮮奶 222 kcal ⇒ 352ml）
//                     乳糖 20 g（20 ÷ 4.7 ⇒ 425ml）
// 兩個數字差 20%，而且 352ml 鮮奶佔 700cc 杯的一半以上、還沒扣冰塊，明顯偏高。
// 改成「寫配方、算出數字」之後，kcal 與糖從同一個 milk_ratio 推出來，
// 內部就不可能再打架，要調整也只有一個地方要改。
//
// 誠實聲明：這仍然是**推估**，不是官方標示。價值在「同一杯每次算出同一個數字」
// 且各欄位彼此自洽，誤差預期 ±15%（原本的手打表是 ±25% 且內部不自洽）。
// 查得到官方數字的杯子，走 drinks.ts 的網搜 fallback 升級成 'searched'。
// ============================================================

// ------------------------------------------------------------
// 1. 杯型與冰塊 → 實際液體量
//
// 手搖杯標的是**杯子容積**，不是液體量。700cc 的杯子正常冰大約只有 525ml 液體，
// 這是原本那張表最大的高估來源之一——它直接拿杯容積在算奶量。
// ------------------------------------------------------------
export const CUP_ML: Record<"M" | "L", number> = { M: 500, L: 700 };

/** 液體佔杯容積的比例。沒講冰塊時當「正常冰」。 */
export const LIQUID_FRACTION: Record<string, number> = {
  "正常冰": 0.75,
  "少冰":   0.81,
  "微冰":   0.87,
  "去冰":   0.97,
  "熱":     0.97,
};
export const DEFAULT_ICE = "正常冰";

/** 全糖時的糖水濃度：每 ml 液體 0.10 g 糖（台灣手搖業界常見值）。 */
export const SUGAR_PCT = 0.10;

export const SWEET_FACTOR: Record<string, number> = {
  "無糖": 0, "微糖": 0.15, "二分糖": 0.2, "三分糖": 0.3,
  "半糖": 0.5, "少糖": 0.7, "八分糖": 0.8, "全糖": 1.0,
};

/** 大杯的「舀出來的東西」（奶精、配料）比中杯多多少。不是 700/500，因為勺子不是線性放大。 */
export const SCOOP_SCALE_L = 1.35;

// ------------------------------------------------------------
// 2. 食材常數
// ------------------------------------------------------------
/** 全脂鮮奶，每 100 ml */
export const MILK = {
  kcal: 63, protein_g: 3.2, fat_g: 3.5, sat_fat_g: 2.2,
  carb_g: 4.8, sugar_g: 4.7, added_sugar_g: 0, sodium_mg: 44, fiber_g: 0,
};

/** 奶精粉（植脂末），每 100 g。飽和脂肪特別高是因為用的是氫化棕櫚／椰子油。 */
export const CREAMER = {
  kcal: 520, protein_g: 2, fat_g: 33, sat_fat_g: 30,
  carb_g: 60, sugar_g: 25, added_sugar_g: 25, sodium_mg: 210, fiber_g: 0,
};

/** 純茶湯，每 100 ml。幾乎是水，但不是零。 */
export const TEA = {
  kcal: 1.5, protein_g: 0, fat_g: 0, sat_fat_g: 0,
  carb_g: 0.3, sugar_g: 0, added_sugar_g: 0, sodium_mg: 2, fiber_g: 0,
};

export interface Nutrients {
  kcal: number; protein_g: number; fat_g: number; sat_fat_g: number;
  carb_g: number; sugar_g: number; added_sugar_g: number;
  sodium_mg: number; fiber_g: number;
}

const ZERO: Nutrients = {
  kcal: 0, protein_g: 0, fat_g: 0, sat_fat_g: 0,
  carb_g: 0, sugar_g: 0, added_sugar_g: 0, sodium_mg: 0, fiber_g: 0,
};

const KEYS = Object.keys(ZERO) as (keyof Nutrients)[];

/** per-100 的成分表 × 份量（100ml 或 100g 為單位的倍數） */
function times(per100: Nutrients | typeof MILK, units: number): Nutrients {
  const out = { ...ZERO };
  for (const k of KEYS) out[k] = (per100 as Nutrients)[k] * units;
  return out;
}

function add(...xs: Nutrients[]): Nutrients {
  const out = { ...ZERO };
  for (const x of xs) for (const k of KEYS) out[k] += x[k];
  return out;
}

// ------------------------------------------------------------
// 3. 配料
//
// ⚠️ 配料是**舀進去的固定一份，不隨冰塊縮放**——去冰不會讓珍珠變多。
//    但配料會**佔掉杯子的體積**，所以珍奶的液體（和糖水）比純奶茶少，
//    這也是為什麼珍奶的糖不是「奶茶的糖 + 珍珠的糖」那麼單純。
//    這兩點是這支最容易寫錯的地方，drink_model_test.ts 各釘了一條。
// ------------------------------------------------------------
export interface Topping {
  /** 中杯的份量 g（大杯自動 × SCOOP_SCALE_L） */
  g: number;
  /** 佔掉的杯內體積 ml（中杯） */
  ml: number;
  /** 每 100 g 的成分 */
  per100: Nutrients;
}

const per100 = (o: Partial<Nutrients>): Nutrients => ({ ...ZERO, ...o });

export const TOPPINGS: Record<string, Topping> = {
  // 煮熟並糖漬過的珍珠。糖是糖漬帶進去的，算 added sugar。
  "珍珠": { g: 70, ml: 70, per100: per100({ kcal: 185, carb_g: 45, sugar_g: 28, added_sugar_g: 28, protein_g: 0.2, fat_g: 0.1, sodium_mg: 5 }) },
  "波霸": { g: 82, ml: 82, per100: per100({ kcal: 185, carb_g: 45, sugar_g: 28, added_sugar_g: 28, protein_g: 0.2, fat_g: 0.1, sodium_mg: 5 }) },
  "椰果": { g: 85, ml: 85, per100: per100({ kcal: 70, carb_g: 17, sugar_g: 16, added_sugar_g: 16, fiber_g: 0.5, sodium_mg: 8 }) },
  "仙草": { g: 90, ml: 90, per100: per100({ kcal: 44, carb_g: 11, sugar_g: 9, added_sugar_g: 9, fiber_g: 0.4, sodium_mg: 10 }) },
  "愛玉": { g: 90, ml: 90, per100: per100({ kcal: 33, carb_g: 8, sugar_g: 7, added_sugar_g: 7, fiber_g: 0.6, sodium_mg: 4 }) },
  "布丁": { g: 75, ml: 75, per100: per100({ kcal: 173, carb_g: 22, sugar_g: 18, added_sugar_g: 18, protein_g: 3, fat_g: 8, sat_fat_g: 4.5, sodium_mg: 70 }) },
  "芋圓": { g: 80, ml: 80, per100: per100({ kcal: 175, carb_g: 42, sugar_g: 20, added_sugar_g: 20, protein_g: 0.6, fat_g: 0.2, sodium_mg: 12 }) },
  "小芋圓": { g: 70, ml: 70, per100: per100({ kcal: 175, carb_g: 42, sugar_g: 20, added_sugar_g: 20, protein_g: 0.6, fat_g: 0.2, sodium_mg: 12 }) },
  "紅豆": { g: 80, ml: 80, per100: per100({ kcal: 160, carb_g: 35, sugar_g: 20, added_sugar_g: 20, protein_g: 3.5, fat_g: 0.3, fiber_g: 3, sodium_mg: 15 }) },
  "冰淇淋": { g: 90, ml: 90, per100: per100({ kcal: 200, carb_g: 24, sugar_g: 21, added_sugar_g: 21, protein_g: 3.5, fat_g: 10, sat_fat_g: 6.5, sodium_mg: 60 }) },
  "奶蓋": { g: 80, ml: 80, per100: per100({ kcal: 230, carb_g: 8, sugar_g: 6, added_sugar_g: 6, protein_g: 2.5, fat_g: 21, sat_fat_g: 14, sodium_mg: 130 }) },
  "白玉": { g: 75, ml: 75, per100: per100({ kcal: 175, carb_g: 42, sugar_g: 20, added_sugar_g: 20, protein_g: 0.6, fat_g: 0.2, sodium_mg: 12 }) },
  "粉粿": { g: 80, ml: 80, per100: per100({ kcal: 150, carb_g: 37, sugar_g: 18, added_sugar_g: 18, protein_g: 0.3, fat_g: 0.1, sodium_mg: 10 }) },
  "西米": { g: 70, ml: 70, per100: per100({ kcal: 120, carb_g: 29, sugar_g: 2, added_sugar_g: 2, protein_g: 0.2, sodium_mg: 3 }) },
  // 養樂多是整瓶倒進去的，也是「固定一份、不隨冰塊變」，歸在這裡最省事
  "養樂多": { g: 100, ml: 100, per100: per100({ kcal: 65, carb_g: 15.5, sugar_g: 15, added_sugar_g: 15, protein_g: 1.1, sodium_mg: 20 }) },
  "芋泥": { g: 150, ml: 140, per100: per100({ kcal: 130, carb_g: 26, sugar_g: 12, added_sugar_g: 10, protein_g: 1.5, fat_g: 2, sat_fat_g: 1.2, fiber_g: 2.5, sodium_mg: 8 }) },
};

// ------------------------------------------------------------
// 4. 配方
// ------------------------------------------------------------
export interface Recipe {
  /** 鮮奶佔「液體」的比例。鮮奶茶類用 0.45。 */
  milk_ratio?: number;
  /** 中杯的奶精粉 g。奶精是**舀的**（固定量），不是倒的，所以不用比例。 */
  creamer_g?: number;
  /** 配料名稱，要在 TOPPINGS 裡 */
  toppings?: string[];
  /** 全糖糖水濃度，覆寫 SUGAR_PCT。檸檬類糖水放比較多。 */
  sugar_pct?: number;
  /**
   * 甜度調不動的固定糖（中杯 g）。黑糖磚、果醬、鮮果原汁屬於這種——
   * 點「無糖黑糖珍奶」還是有黑糖。大杯自動 × SCOOP_SCALE_L。
   */
  fixed_sugar_g?: number;
  /** 果汁／鮮果類：每 100 ml 果汁的成分，佔液體 juice_ratio */
  juice_ratio?: number;
}

/**
 * 算一杯的營養。
 *
 * @param size      M（杯容積 500cc）/ L（700cc）
 * @param sweetness 「無糖」「半糖」…；認不得的字串一律當全糖（寧可高估糖，不要低估）
 * @param ice       「去冰」「正常冰」…；null／認不得＝正常冰
 */
export function compose(
  r: Recipe,
  size: "M" | "L",
  sweetness: string,
  ice: string | null = null,
): Nutrients {
  const cupMl = CUP_ML[size];
  const liquidFrac = LIQUID_FRACTION[ice ?? ""] ?? LIQUID_FRACTION[DEFAULT_ICE];
  const scoop = size === "L" ? SCOOP_SCALE_L : 1;

  // 配料先佔掉體積，剩下才是液體。所以珍奶的糖水比純奶茶少。
  const toppings = (r.toppings ?? []).map((name) => {
    const t = TOPPINGS[name];
    if (!t) throw new Error(`未知的配料：${name}`);
    return t;
  });
  const toppingMl = toppings.reduce((s, t) => s + t.ml * scoop, 0);
  const liquidMl = Math.max(0, cupMl * liquidFrac - toppingMl);

  // --- 液體的組成 ---
  const milkMl = liquidMl * (r.milk_ratio ?? 0);
  const juiceMl = liquidMl * (r.juice_ratio ?? 0);
  const teaMl = Math.max(0, liquidMl - milkMl - juiceMl);

  const parts: Nutrients[] = [
    times(MILK, milkMl / 100),
    times(TEA, teaMl / 100),
    times(CREAMER, ((r.creamer_g ?? 0) * scoop) / 100),
    ...toppings.map((t) => times(t.per100, (t.g * scoop) / 100)),
  ];

  // 鮮果汁：熱量與糖都算，但糖是天然果糖——WHO 把「果汁的糖」算進游離糖，所以 added 也算。
  if (juiceMl > 0) {
    parts.push(times(per100({ kcal: 45, carb_g: 11, sugar_g: 10, added_sugar_g: 10, sodium_mg: 3, fiber_g: 0.2 }), juiceMl / 100));
  }

  const base = add(...parts);

  // --- 糖水（可調甜度）---
  const f = SWEET_FACTOR[sweetness] ?? 1.0;
  const syrupG = liquidMl * (r.sugar_pct ?? SUGAR_PCT) * f;
  // --- 固定糖（黑糖磚、果醬）：甜度調不動 ---
  const fixedG = (r.fixed_sugar_g ?? 0) * scoop;
  const sugarG = syrupG + fixedG;

  return {
    kcal: base.kcal + sugarG * 4,
    protein_g: base.protein_g,
    fat_g: base.fat_g,
    sat_fat_g: base.sat_fat_g,
    carb_g: base.carb_g + sugarG,
    sugar_g: base.sugar_g + sugarG,
    added_sugar_g: base.added_sugar_g + sugarG,
    sodium_mg: base.sodium_mg,
    fiber_g: base.fiber_g,
  };
}

/** 給訊息與資料庫用的四捨五入。kcal 與鈉取整數，其餘一位小數。 */
export function roundNutrients(n: Nutrients): Nutrients {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kcal: Math.round(n.kcal),
    protein_g: r1(n.protein_g),
    fat_g: r1(n.fat_g),
    sat_fat_g: r1(n.sat_fat_g),
    carb_g: r1(n.carb_g),
    sugar_g: r1(n.sugar_g),
    added_sugar_g: r1(n.added_sugar_g),
    sodium_mg: Math.round(n.sodium_mg),
    fiber_g: r1(n.fiber_g),
  };
}
