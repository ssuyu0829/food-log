// 體重校準的測試。不碰 db，跑法乾淨：
//   deno test supabase/functions/_shared/weight_test.ts
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  calibrate, type DayIntake, KCAL_PER_KG, readTdee, slopePerDay, type WeighIn,
} from "./weight.ts";

const day = (n: number) => new Date(2026, 8, 1 + n);          // 2026-09-01 起算
const weighIns = (n: number, start: number, perDay: number): WeighIn[] =>
  Array.from({ length: n }, (_, i) => ({ at: day(i * 3), kg: start + perDay * i * 3 }));
const intake = (n: number, kcal: number, count = 4): DayIntake[] =>
  Array.from({ length: n }, (_, i) => ({ date: `d${i}`, kcal, recordCount: count }));

Deno.test("斜率：完全水平的體重＝0", () => {
  assertEquals(slopePerDay([{ at: day(0), kg: 62 }, { at: day(10), kg: 62 }]), 0);
});

Deno.test("斜率：每天 +0.01 kg 就是 0.01", () => {
  const s = slopePerDay([{ at: day(0), kg: 62 }, { at: day(100), kg: 63 }]);
  assertAlmostEquals(s!, 0.01, 1e-9);
});

Deno.test("斜率：只有一筆或同一天量的算不出來，回 null（不要硬給 0）", () => {
  assertEquals(slopePerDay([{ at: day(0), kg: 62 }]), null);
  assertEquals(slopePerDay([{ at: day(0), kg: 62 }, { at: day(0), kg: 63 }]), null);
});

// ------------------------------------------------------------
// 門檻：不到就不下結論。比照 time-control /med 的做法。
// ------------------------------------------------------------
Deno.test("量太少次：不下結論", () => {
  const r = calibrate(weighIns(5, 62, 0), intake(30, 2000));
  assertEquals(r.ok, false);
  assert(!r.ok && r.reason.includes("體重只量了 5 次"));
});

Deno.test("天數跨得太短：不下結論（短期體重是水分在動）", () => {
  const ws: WeighIn[] = Array.from({ length: 12 }, (_, i) => ({ at: day(i), kg: 62 }));
  const r = calibrate(ws, intake(30, 2000));
  assertEquals(r.ok, false);
  assert(!r.ok && r.reason.includes("橫跨"));
});

// 🔴 這條是整支最重要的門檻。
// 漏記的天會把平均攝取拉低，反推的 TDEE 就會低到沒有意義。
Deno.test("記錄不夠完整：不下結論，而且理由要講到漏記", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 2000, 1));  // 每天只記 1 筆
  assertEquals(r.ok, false);
  assert(!r.ok && r.reason.includes("完整"));
  assert(!r.ok && r.detail.includes("漏記"));
});

Deno.test("只有記完整的天會進平均，漏記的天不算", () => {
  const mixed: DayIntake[] = [
    ...intake(20, 2200, 5),          // 完整的天
    ...intake(10, 700, 1).map((d, i) => ({ ...d, date: `x${i}` })),  // 漏記的天
  ];
  const r = calibrate(weighIns(12, 62, 0), mixed);
  assert(r.ok);
  assertEquals(r.loggedKcal, 2200);  // 700 那些天完全沒有拉低平均
});

// ------------------------------------------------------------
// 反推
// ------------------------------------------------------------
Deno.test("體重持平時，反推的 TDEE 就等於記錄的攝取", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 2100));
  assert(r.ok);
  assertEquals(r.surplusKcal, 0);
  assertEquals(r.impliedTdee, 2100);
});

Deno.test("每週增重 0.2 kg：盈餘要是 0.2/7*7700 ≈ 220 kcal/天", () => {
  const r = calibrate(weighIns(12, 62, 0.2 / 7), intake(30, 2400));
  assert(r.ok);
  assertAlmostEquals(r.surplusKcal, 220, 3);
  assertAlmostEquals(r.kgPerWeek, 0.2, 0.01);
  assertEquals(r.impliedTdee, 2400 - r.surplusKcal);
});

Deno.test("減重時反推的 TDEE 會高於記錄攝取", () => {
  const r = calibrate(weighIns(12, 62, -0.5 / 7), intake(30, 1800));
  assert(r.ok);
  assert(r.surplusKcal < 0);
  assert(r.impliedTdee > 1800);
});

// ------------------------------------------------------------
// 🔴 k 只有在使用者自己給了參考 TDEE 時才算。
//    我們不會偷偷套一個公式 TDEE 再宣稱「AI 高估了 X%」。
// ------------------------------------------------------------
Deno.test("沒有參考 TDEE 就不給 k", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 2100));
  assert(r.ok);
  assertEquals(r.k, null);
});

Deno.test("有參考 TDEE：體重持平但記錄比參考低 ⇒ k > 1（多半是漏記）", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 1800), 2100);
  assert(r.ok && r.k !== null);
  assertAlmostEquals(r.k!, 2100 / 1800, 0.01);
  assert(r.k! > 1);
});

Deno.test("有參考 TDEE：記錄比參考高 ⇒ k < 1（多半是高估）", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 2500), 2100);
  assert(r.ok && r.k !== null);
  assert(r.k! < 1);
});

// ------------------------------------------------------------
// 判讀只給範圍，不給百分比——體重分不開「高估」與「漏記」。
// ------------------------------------------------------------
Deno.test("反推 TDEE 低到不合理時，要指向漏記", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 1100));
  assert(r.ok);
  assert(readTdee(r).includes("漏記"));
});

Deno.test("反推 TDEE 高到不合理時，要指向高估", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 3500));
  assert(r.ok);
  assert(readTdee(r).includes("高估"));
});

Deno.test("落在合理範圍時，說的是「對得起來」", () => {
  const r = calibrate(weighIns(12, 62, 0), intake(30, 2100));
  assert(r.ok);
  assert(readTdee(r).includes("對得起來"));
});

Deno.test("1 kg = 7700 kcal 的換算沒有被改掉", () => {
  assertEquals(KCAL_PER_KG, 7700);
});

// ------------------------------------------------------------
// 輸入解析
// ------------------------------------------------------------
import { parseWeight } from "./weight.ts";

Deno.test("體重：認得四種寫法", () => {
  for (const s of ["體重 62.5", "體重62.5", "62.5kg", "62.5 公斤"]) {
    assertEquals(parseWeight(s)?.kg, 62.5, s);
  }
});

// 🔴 這條是最重要的一條。裸數字在「回覆記錄訊息」時已經是份量倍率，
//    在一般情境會被丟給 AI 當食物；被體重吃掉的話兩個功能一起壞。
Deno.test("體重：裸數字一律不認", () => {
  assertEquals(parseWeight("62.5"), null);
  assertEquals(parseWeight("0.7"), null);
  assertEquals(parseWeight("2/3"), null);
});

Deno.test("體重：食物文字不會被誤判成體重", () => {
  assertEquals(parseWeight("滷肉飯 一碗"), null);
  assertEquals(parseWeight("50嵐 四季春 微糖 大"), null);
  assertEquals(parseWeight("鮮奶茶"), null);
});

Deno.test("體重：補登日期前綴", () => {
  const r = parseWeight("9/8 體重 62.3", new Date(2026, 8, 10));
  assertEquals(r?.kg, 62.3);
  assertEquals(r?.date, "2026-09-08");
  assertEquals(parseWeight("2025/12/31 體重 60", new Date(2026, 8, 10))?.date, "2025-12-31");
});

Deno.test("體重：離譜的數字擋掉（跟資料庫的 check 同一組界線）", () => {
  assertEquals(parseWeight("體重 5"), null);
  assertEquals(parseWeight("體重 500"), null);
});

Deno.test("體重：全形數字也認得", () => {
  assertEquals(parseWeight("體重 ６２．５")?.kg, 62.5);
});
