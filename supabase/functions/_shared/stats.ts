// 統計查詢：當日 / 區間。Bot 的 /today /week 與每日每週推播共用同一份邏輯。
import { db, localDate } from "./db.ts";

export interface MealRow {
  id: number; eaten_at: string; title: string | null; total_kcal: number | null;
  sugar_g: number | null; protein_g: number | null; fat_g: number | null;
  carb_g: number | null; is_drink: boolean; source: string; confidence: string | null;
  photo_path: string | null; estimate_note: string | null;
}

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
    .select("id,eaten_at,title,total_kcal,sugar_g,protein_g,fat_g,carb_g,is_drink,source,confidence,photo_path,estimate_note")
    .is("deleted_at", null)
    .gte("eaten_at", startISO).lt("eaten_at", endISO)
    .order("eaten_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MealRow[];
}

export interface Totals {
  kcal: number; sugar_g: number; protein_g: number; fat_g: number; carb_g: number;
  drinkCount: number; mealCount: number; drinkKcal: number;
}

export function totalsOf(rows: MealRow[]): Totals {
  const t: Totals = { kcal: 0, sugar_g: 0, protein_g: 0, fat_g: 0, carb_g: 0, drinkCount: 0, mealCount: 0, drinkKcal: 0 };
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
