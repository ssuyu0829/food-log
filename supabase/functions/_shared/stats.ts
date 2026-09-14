// 統計查詢：當日 / 區間。Bot 的 /today /week 與每日每週推播共用同一份邏輯。
import { db, localDate } from "./db.ts";

export interface MealRow {
  id: number; eaten_at: string; title: string | null; total_kcal: number | null;
  sugar_g: number | null; protein_g: number | null; fat_g: number | null;
  carb_g: number | null; is_drink: boolean; source: string; confidence: string | null;
  photo_path: string | null; estimate_note: string | null;
  // 2026-09-10 加的五個維度。null = 沒量過（9/10 之前的紀錄全是），0 = 量過是零。
  sodium_mg: number | null; fiber_g: number | null; sat_fat_g: number | null;
  added_sugar_g: number | null; veg_servings: number | null;
}

export const MEAL_COLUMNS =
  "id,eaten_at,title,total_kcal,sugar_g,protein_g,fat_g,carb_g,is_drink,source,confidence," +
  "photo_path,estimate_note,sodium_mg,fiber_g,sat_fat_g,added_sugar_g,veg_servings";

export const TZ = "Asia/Taipei";

/**
 * 帳本的一天從凌晨 4 點開始，不是午夜。
 *
 * 2026-09-06 加入。起因：00:30 記的宵夜被算成隔天，本人得手動把整筆搬回去。
 * 深夜吃東西是常態，午夜切日界線會固定把它切錯邊。
 * ⚠️ 改這個值要把四支 function 全部重新部署，而且 pwa/app.js 裡有一份必須同步的複本。
 */
export const DAY_START_HOUR = 4;

/** 帳本日 dateStr 的 UTC 邊界（該日 04:00 到隔日 04:00） */
export function dayBounds(dateStr: string): [string, string] {
  const hh = String(DAY_START_HOUR).padStart(2, "0");
  const start = new Date(`${dateStr}T${hh}:00:00+08:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

/** 這個時間點屬於哪一個帳本日（凌晨 4 點前算前一天） */
export function logicalDate(d = new Date(), tz = TZ): string {
  return localDate(new Date(d.getTime() - DAY_START_HOUR * 3600_000), tz);
}

/** 往前 n 個帳本日（含今天）的 UTC 邊界 */
export function lastNDays(n: number): [string, string, string[]] {
  const today = logicalDate();
  const [, end] = dayBounds(today);
  const days: string[] = [];
  const cursor = new Date(`${today}T12:00:00+08:00`); // 用正午當游標，不會被邊界誤差咬到
  cursor.setDate(cursor.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    days.push(localDate(cursor, TZ));
    cursor.setDate(cursor.getDate() + 1);
  }
  const [start] = dayBounds(days[0]);
  return [start, end, days];
}

export async function mealsBetween(startISO: string, endISO: string): Promise<MealRow[]> {
  const { data, error } = await db.from("meals")
    .select(MEAL_COLUMNS)
    .is("deleted_at", null)
    .gte("eaten_at", startISO).lt("eaten_at", endISO)
    .order("eaten_at", { ascending: true });
  if (error) throw error;
  // MEAL_COLUMNS 是變數，supabase-js 推不出型別，所以要先過 unknown
  return (data ?? []) as unknown as MealRow[];
}

export interface Totals {
  kcal: number; sugar_g: number; protein_g: number; fat_g: number; carb_g: number;
  drinkCount: number; mealCount: number; drinkKcal: number;
  /**
   * 五個新維度的加總。**沒有任何一筆量過就是 null**，不是 0——
   * 這是 2026-09-10 之前 33 筆舊資料的狀態，填 0 會讓達標率整個算錯。
   */
  sodium_mg: number | null; fiber_g: number | null; sat_fat_g: number | null;
  added_sugar_g: number | null; veg_servings: number | null;
}

const EXTRA_KEYS = ["sodium_mg", "fiber_g", "sat_fat_g", "added_sugar_g", "veg_servings"] as const;
type ExtraKey = typeof EXTRA_KEYS[number];

export function totalsOf(rows: MealRow[]): Totals {
  const t: Totals = {
    kcal: 0, sugar_g: 0, protein_g: 0, fat_g: 0, carb_g: 0,
    drinkCount: 0, mealCount: 0, drinkKcal: 0,
    sodium_mg: null, fiber_g: null, sat_fat_g: null, added_sugar_g: null, veg_servings: null,
  };
  for (const k of EXTRA_KEYS) {
    const measured = rows.filter((r) => r[k] !== null && r[k] !== undefined);
    if (measured.length) {
      const sum = measured.reduce((s, r) => s + Number(r[k]), 0);
      t[k] = k === "sodium_mg" ? Math.round(sum) : Math.round(sum * 10) / 10;
    }
  }
  for (const r of rows) {
    t.kcal += Number(r.total_kcal ?? 0);
    t.sugar_g += Number(r.sugar_g ?? 0);
    t.protein_g += Number(r.protein_g ?? 0);
    t.fat_g += Number(r.fat_g ?? 0);
    t.carb_g += Number(r.carb_g ?? 0);
    if (r.is_drink) { t.drinkCount++; t.drinkKcal += Number(r.total_kcal ?? 0); }
    else t.mealCount++;
  }
  t.sugar_g = Math.round(t.sugar_g * 10) / 10;
  return t;
}

/** 依帳本日分組（凌晨 4 點前算前一天） */
export function groupByDay(rows: MealRow[]): Map<string, MealRow[]> {
  const m = new Map<string, MealRow[]>();
  for (const r of rows) {
    const d = logicalDate(new Date(r.eaten_at), TZ);
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(r);
  }
  return m;
}

export const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));

// ============================================================
// 2026-09-10：記錄完整度
//
// 為什麼這一段要排在所有營養統計前面：
// 2026-09-03～09 那 7 天裡，9/7 只有 3 筆、9/8 只有 2 筆（而且兩筆都在 00:02–00:03），
// 但這兩天的「平均熱量」卻是全週最高的 2229 / 2320 kcal——
// 那不是吃比較多，是**只記了大餐**。
// 任何「平均每天 X kcal」「達標 N 天」的結論都站在這個沒被量過的前提上，
// 所以完整度必須是報表的第一行，不是附註。
// ============================================================

/** 一天少於這個筆數就當「疑似漏記」 */
export const THIN_DAY_MEALS = 2;
/** 首餐到末餐的間隔小於這個小時數，也算「疑似漏記」（只記了一頓的形狀） */
export const THIN_DAY_SPAN_HOURS = 6;
/** 這個時刻之後吃的算宵夜 */
export const LATE_NIGHT_HOUR = 22;

export interface DayShape {
  date: string;
  /** 今天（還沒過完的那天）。永遠不會被標成 thin。 */
  inProgress: boolean;
  count: number;
  kcal: number;
  first: string | null;   // HH:MM
  last: string | null;
  spanHours: number;
  thin: boolean;
}

export interface Completeness {
  totalDays: number;      // 已經過完、可以判斷的天數（不含今天）
  loggedDays: number;      // 有任何一筆的天數
  goodDays: number;        // 看起來記完整的天數
  thinDays: DayShape[];    // 疑似漏記的天（有記，但形狀不對）
  emptyDays: string[];     // 完全沒記的天
  lateNightCount: number;  // 22:00 之後的筆數
  shapes: DayShape[];
}

/** 這個時間點在帳本日裡的「小時」。凌晨 2 點算前一天的第 22 小時。 */
function hourInLogicalDay(iso: string): number {
  const s = hhmm(iso);
  const h = Number(s.slice(0, 2)) + Number(s.slice(3, 5)) / 60;
  return h < DAY_START_HOUR ? h + 24 : h;
}

/**
 * ⚠️ `today` 是「還沒過完」的那一天，一律不判斷。
 *    2026-09-10 部署後實測抓到的誤報：當天中午只記了 1 筆，就被標成「疑似漏記」——
 *    但那天根本還沒過完，晚餐當然還沒記。把進行中的那天算進分母也會拉低達標率。
 *    傳 null 可以關掉這個豁免（跑歷史區間時用）。
 */
export function completenessOf(
  rows: MealRow[],
  days: string[],
  today: string | null = logicalDate(),
): Completeness {
  const byDay = groupByDay(rows);
  const shapes: DayShape[] = [];
  const emptyDays: string[] = [];

  for (const d of days) {
    const inProgress = d === today;
    const rs = byDay.get(d) ?? [];
    if (!rs.length) {
      if (!inProgress) emptyDays.push(d);   // 今天還沒記不算漏記
      continue;
    }
    const hours = rs.map((r) => hourInLogicalDay(r.eaten_at));
    const span = Math.max(...hours) - Math.min(...hours);
    shapes.push({
      date: d,
      inProgress,
      count: rs.length,
      kcal: totalsOf(rs).kcal,
      first: hhmm(rs[0].eaten_at),
      last: hhmm(rs[rs.length - 1].eaten_at),
      spanHours: Math.round(span * 10) / 10,
      thin: !inProgress && (rs.length <= THIN_DAY_MEALS || span < THIN_DAY_SPAN_HOURS),
    });
  }

  const thinDays = shapes.filter((s) => s.thin);
  const judged = shapes.filter((s) => !s.inProgress);
  return {
    // 分母只算「已經過完」的天，今天不進來
    totalDays: days.filter((d) => d !== today).length,
    loggedDays: judged.length,
    goodDays: judged.length - thinDays.length,
    thinDays,
    emptyDays,
    lateNightCount: rows.filter((r) => {
      const h = hourInLogicalDay(r.eaten_at);
      return h >= LATE_NIGHT_HOUR;
    }).length,
    shapes,
  };
}

// ============================================================
// 2026-09-10：飲食健康的參考門檻
//
// 全部寫在這裡並附出處，不要散在 format.ts 的字串裡——
// 「凍結判準時要連用哪一個數字裁決一起凍結」。
// ============================================================
export const TARGETS = {
  /** 鈉 mg／天。WHO 建議 < 2000 mg（≈ 5 g 鹽）。外食族最常破的一項。 */
  sodium_mg: 2000,
  /** 膳食纖維 g／天。國健署成人建議 25–35 g。 */
  fiber_g: 25,
  /** 蔬菜份數／天。「天天5蔬果」裡蔬菜那 3 份。1 份 ≈ 熟半碗。 */
  veg_servings: 3,
  /** 添加糖／游離糖 g／天。WHO：< 10% 總熱量，以 2000 kcal 計 = 50 g。理想 < 25 g。 */
  added_sugar_g: 50,
  added_sugar_ideal_g: 25,
  /** 飽和脂肪 g／天。< 10% 總熱量，以 2000 kcal 計 = 22 g。 */
  sat_fat_g: 22,
  /** 蛋白質 g/kg 體重／天。要有體重才算得出來（見 weight.ts）。 */
  protein_per_kg: 1.2,
} as const;

/** 這一天達標了沒。沒量過回 null，**不要回 false**——沒量過不等於沒達標。 */
export function metTargets(t: Totals): Record<string, boolean | null> {
  const le = (v: number | null, max: number) => (v === null ? null : v <= max);
  const ge = (v: number | null, min: number) => (v === null ? null : v >= min);
  return {
    sodium_mg: le(t.sodium_mg, TARGETS.sodium_mg),
    fiber_g: ge(t.fiber_g, TARGETS.fiber_g),
    veg_servings: ge(t.veg_servings, TARGETS.veg_servings),
    added_sugar_g: le(t.added_sugar_g, TARGETS.added_sugar_g),
    sat_fat_g: le(t.sat_fat_g, TARGETS.sat_fat_g),
  };
}
