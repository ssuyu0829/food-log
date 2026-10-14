import { assertEquals } from "jsr:@std/assert@1";
import { dayBounds, lastNDays, logicalDate, DAY_START_HOUR } from "./stats.ts";

Deno.test("凌晨 4 點前算前一天", () => {
  assertEquals(DAY_START_HOUR, 4);
  const cases: [string, string][] = [
    ["2026-09-05T00:30:00+08:00", "2026-09-04"], // 紅油抄手原本那筆
    ["2026-09-05T03:59:00+08:00", "2026-09-04"], // 邊界前一分鐘
    ["2026-09-05T04:00:00+08:00", "2026-09-05"], // 邊界當下
    ["2026-09-04T23:30:00+08:00", "2026-09-04"], // 改過之後那筆
    ["2026-09-06T12:00:00+08:00", "2026-09-06"], // 正常白天
    ["2026-01-01T02:00:00+08:00", "2025-12-31"], // 跨年
    ["2026-03-01T01:00:00+08:00", "2026-02-28"], // 跨月
  ];
  for (const [iso, want] of cases) assertEquals(logicalDate(new Date(iso)), want, iso);
});

Deno.test("dayBounds 是 04:00 到隔日 04:00", () => {
  const [s, e] = dayBounds("2026-09-04");
  assertEquals(s, new Date("2026-09-04T04:00:00+08:00").toISOString());
  assertEquals(e, new Date("2026-09-05T04:00:00+08:00").toISOString());
  // 兩筆紅油抄手（00:30）必須落在 9/4 這個區間裡
  const t = new Date("2026-09-05T00:30:00+08:00").toISOString();
  assertEquals(t >= s && t < e, true);
});

Deno.test("lastNDays 天數與端點", () => {
  const [s, e, days] = lastNDays(7);
  assertEquals(days.length, 7);
  assertEquals(days[6], logicalDate());          // 最後一天＝今天
  assertEquals(s, dayBounds(days[0])[0]);        // 起點對齊第一天的 04:00
  assertEquals(e, dayBounds(days[6])[1]);        // 終點對齊最後一天的隔日 04:00
  // 日期字串必須連續、不重複
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(`${days[i - 1]}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() + 1);
    assertEquals(days[i], prev.toISOString().slice(0, 10));
  }
});

// ------------------------------------------------------------
// 2026-09-10 部署後實測抓到的誤報：
// 當天中午只記了 1 筆就被標成「疑似漏記」——但那天還沒過完，晚餐當然還沒記。
// ------------------------------------------------------------
import { completenessOf, type MealRow } from "./stats.ts";

const meal = (iso: string): MealRow => ({
  id: 1, eaten_at: iso, title: "x", total_kcal: 500, sugar_g: 0, protein_g: 0,
  fat_g: 0, carb_g: 0, is_drink: false, source: "text", confidence: null,
  photo_path: null, estimate_note: null, sodium_mg: null, fiber_g: null,
  sat_fat_g: null, added_sugar_g: null, veg_servings: null,
});

const DAYS = ["2026-09-09", "2026-09-10"];
// 09-09 兩筆相隔一分鐘（真的漏記）、09-10 中午一筆（今天，還沒過完）
const ROWS = [
  meal("2026-09-09T04:00:00Z"), meal("2026-09-09T04:01:00Z"),
  meal("2026-09-10T04:00:00Z"),
];

Deno.test("完整度：進行中的今天不判斷、也不算進分母", () => {
  const c = completenessOf(ROWS, DAYS, "2026-09-10");
  assertEquals(c.thinDays.map((d) => d.date), ["2026-09-09"]);  // 今天不在裡面
  assertEquals(c.totalDays, 1);   // 分母只有 09-09
  assertEquals(c.loggedDays, 1);
});

Deno.test("完整度：今天完全沒記不算漏記", () => {
  const c = completenessOf(ROWS.slice(0, 2), DAYS, "2026-09-10");
  assertEquals(c.emptyDays, []);
});

Deno.test("完整度：today 傳 null 就全部照判（跑歷史區間時用）", () => {
  const c = completenessOf(ROWS, DAYS, null);
  assertEquals(c.thinDays.map((d) => d.date), ["2026-09-09", "2026-09-10"]);
  assertEquals(c.totalDays, 2);
});

// ------------------------------------------------------------
// 蛋白質目標：唯一跟體重掛鉤的門檻
// ------------------------------------------------------------
import { metTargets, proteinTarget, TARGETS, totalsOf } from "./stats.ts";

Deno.test("蛋白質目標：體重 × 倍率，四捨五入到整數", () => {
  assertEquals(proteinTarget(62.5), 75);          // 62.5 × 1.2
  assertEquals(proteinTarget(62.5, 1.6), 100);
  assertEquals(TARGETS.protein_per_kg, 1.2);
});

Deno.test("蛋白質目標：沒體重或倍率不合理就是 null，不是 0", () => {
  assertEquals(proteinTarget(null), null);
  assertEquals(proteinTarget(0), null);
  assertEquals(proteinTarget(62.5, 0), null);
  assertEquals(proteinTarget(62.5, NaN), null);
});

Deno.test("蛋白質達標：沒目標整項 null；有目標照比", () => {
  const rows = [{ ...meal("2026-09-10T04:00:00Z"), protein_g: 80 }];
  const t = totalsOf(rows);
  assertEquals(metTargets(t).protein_g, null);
  assertEquals(metTargets(t, 75).protein_g, true);
  assertEquals(metTargets(t, 90).protein_g, false);
});
