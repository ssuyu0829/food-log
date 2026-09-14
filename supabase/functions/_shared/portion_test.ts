// 份量倍率與「挑掉細項」的算術測試。
// 這支不碰 db，所以跑法比另外兩個測試乾淨：
//   deno test supabase/functions/_shared/portion_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { type ItemLike, parsePortion, scaleMacros, sumItems } from "./portion.ts";

// 一張三菜的桌菜照：滷肉飯 / 燙青菜 / 別人的炸雞
const ITEMS: ItemLike[] = [
  { kcal: 350, protein_g: 12, fat_g: 10, carb_g: 55, sugar_g: 2.5 },
  { kcal: 60,  protein_g: 3,  fat_g: 2,  carb_g: 6,  sugar_g: 1.2 },
  { kcal: 300, protein_g: 20, fat_g: 20, carb_g: 12, sugar_g: 0.4 },
];

Deno.test("加總：沒挑掉任何一項＝三項相加", () => {
  assertEquals(sumItems(ITEMS, 1).total_kcal, 710);
  assertEquals(sumItems(ITEMS, 1).sugar_g, 4.1);
});

Deno.test("挑掉一項＝其餘項的加總，不是整筆打折", () => {
  const cut = ITEMS.map((i, n) => (n === 2 ? { ...i, excluded: true } : i));
  assertEquals(sumItems(cut, 1).total_kcal, 410);
  assertEquals(sumItems(cut, 1).protein_g, 15);
});

Deno.test("挑回來就回到原值（軟排除的重點）", () => {
  const cut = ITEMS.map((i, n) => (n === 2 ? { ...i, excluded: true } : i));
  const back = cut.map((i) => ({ ...i, excluded: false }));
  assertEquals(sumItems(back, 1).total_kcal, sumItems(ITEMS, 1).total_kcal);
});

Deno.test("×2 之後再挑掉一項，算的是「其餘項 ×2」", () => {
  const cut = ITEMS.map((i, n) => (n === 2 ? { ...i, excluded: true } : i));
  assertEquals(sumItems(cut, 2).total_kcal, 820);
});

Deno.test("倍率與挑掉是兩個獨立維度，任何順序都同一個答案", () => {
  const cut = ITEMS.map((i, n) => (n === 0 ? { ...i, excluded: true } : i));
  assertEquals(sumItems(cut, 0.5).total_kcal, 180);
  assertEquals(sumItems(cut, 0.5).total_kcal, Math.round(sumItems(cut, 1).total_kcal * 0.5));
});

Deno.test("每一項都挑掉＝0，不是報錯", () => {
  const none = ITEMS.map((i) => ({ ...i, excluded: true }));
  assertEquals(sumItems(none, 1).total_kcal, 0);
  assertEquals(sumItems(none, 1).sugar_g, 0);
});

Deno.test("零細項的筆按比例縮放，不會變成 0（修的是既有 bug）", () => {
  const meal = { total_kcal: 500, protein_g: 20, fat_g: 15, carb_g: 60, sugar_g: 8.4 };
  assertEquals(sumItems([], 2).total_kcal, 0);          // 加總空陣列就是 0，所以不能走這條
  assertEquals(scaleMacros(meal, 2).total_kcal, 1000);  // 要走這條
  assertEquals(scaleMacros(meal, 2).sugar_g, 16.8);
  assertEquals(scaleMacros(meal, 0.5 / 2).total_kcal, 125); // ×2 之後改成 ×0.5
});

Deno.test("解析：小數與省略的 0", () => {
  assertEquals(parsePortion("0.7"), { kind: "ok", value: 0.7 });
  assertEquals(parsePortion(".5"), { kind: "ok", value: 0.5 });
  assertEquals(parsePortion("3"), { kind: "ok", value: 3 });
});

Deno.test("解析：各種乘號前綴與「倍」字尾", () => {
  for (const s of ["×0.7", "x0.7", "X0.7", "*0.7", "×0.7倍", " 0.7 倍 "]) {
    assertEquals(parsePortion(s), { kind: "ok", value: 0.7 }, s);
  }
});

Deno.test("解析：分數（三分之二打 2/3）", () => {
  assertEquals(parsePortion("2/3"), { kind: "ok", value: 0.67 });
  assertEquals(parsePortion("1 / 4"), { kind: "ok", value: 0.25 });
  assertEquals(parsePortion("1/0"), null);
});

Deno.test("解析：全形數字也認得", () => {
  assertEquals(parsePortion("１．５"), { kind: "ok", value: 1.5 });
});

Deno.test("解析：超過 20 當成「他想打熱量」，不照吞成 ×350", () => {
  assertEquals(parsePortion("350"), { kind: "out_of_range", value: 350 });
  assertEquals(parsePortion("20"), { kind: "ok", value: 20 });
});

Deno.test("解析：不是數字就回 null（否則會吃掉『回覆順手記別的東西』）", () => {
  for (const s of ["", "  ", "滷肉飯 一碗", "0", "-1", "abc", "1.2.3", "50嵐 四季春"]) {
    assertEquals(parsePortion(s), null, s);
  }
});

// ------------------------------------------------------------
// 2026-09-10：鈉／纖維／飽和脂肪／添加糖／蔬菜份數
// 這五欄跟前面五欄的規則不同——**沒量過要保持 null，不能加總成 0**。
// ------------------------------------------------------------

// 同一張桌菜照，這次帶新維度。第三項（別人的炸雞）鈉很高、蔬菜 0。
const ITEMS_N: ItemLike[] = [
  { kcal: 350, protein_g: 12, fat_g: 10, carb_g: 55, sugar_g: 2.5,
    sodium_mg: 900, fiber_g: 1.5, sat_fat_g: 3.2, added_sugar_g: 2, veg_servings: 0 },
  { kcal: 60,  protein_g: 3,  fat_g: 2,  carb_g: 6,  sugar_g: 1.2,
    sodium_mg: 220, fiber_g: 2.8, sat_fat_g: 0.3, added_sugar_g: 0, veg_servings: 1 },
  { kcal: 300, protein_g: 20, fat_g: 20, carb_g: 12, sugar_g: 0.4,
    sodium_mg: 780, fiber_g: 0.4, sat_fat_g: 6.1, added_sugar_g: 1, veg_servings: 0 },
];

Deno.test("新維度：沒挑掉任何一項＝三項相加", () => {
  const m = sumItems(ITEMS_N, 1);
  assertEquals(m.sodium_mg, 1900);
  assertEquals(m.fiber_g, 4.7);
  assertEquals(m.sat_fat_g, 9.6);
  assertEquals(m.added_sugar_g, 3);
  assertEquals(m.veg_servings, 1);
});

Deno.test("新維度：挑掉別人的炸雞，鈉與飽和脂肪要一起降", () => {
  const items = ITEMS_N.map((i, k) => (k === 2 ? { ...i, excluded: true } : i));
  const m = sumItems(items, 1);
  assertEquals(m.sodium_mg, 1120);   // 1900 − 780
  assertEquals(m.sat_fat_g, 3.5);    // 9.6 − 6.1
  assertEquals(m.veg_servings, 1);   // 炸雞本來就 0，不受影響
});

Deno.test("新維度：份量 0.7 時蔬菜份數也跟著打折", () => {
  const m = sumItems(ITEMS_N, 0.7);
  assertEquals(m.sodium_mg, 1330);
  assertEquals(m.veg_servings, 0.7);
});

// 🔴 這一條是整組測試的重點。
// 2026-09-10 之前的 33 筆記錄這五欄全是 null；如果加總成 0 寫回資料庫，
// 「沒量過」就永久變成「量過，答案是零」，週報會算出假的達標率。
Deno.test("新維度：全部沒量過要回 null，不可以回 0", () => {
  const m = sumItems(ITEMS, 1);   // ITEMS 是舊格式，五欄都沒有
  assertEquals(m.sodium_mg, null);
  assertEquals(m.fiber_g, null);
  assertEquals(m.sat_fat_g, null);
  assertEquals(m.added_sugar_g, null);
  assertEquals(m.veg_servings, null);
  assertEquals(m.total_kcal, 710);  // 舊欄位照常算
});

Deno.test("新維度：只要有一項量過，其餘 null 的當 0 加", () => {
  const items: ItemLike[] = [
    { kcal: 100, sodium_mg: 500 },
    { kcal: 100 },                 // 這項沒有鈉資料
  ];
  assertEquals(sumItems(items, 1).sodium_mg, 500);
});

Deno.test("新維度：零細項的筆縮放時，null 維持 null", () => {
  const meal = { total_kcal: 200, protein_g: 8, fat_g: 5, carb_g: 30, sugar_g: 10,
                 sodium_mg: null, fiber_g: 2, sat_fat_g: null,
                 added_sugar_g: null, veg_servings: null };
  const m = scaleMacros(meal, 0.5);
  assertEquals(m.total_kcal, 100);
  assertEquals(m.sodium_mg, null);
  assertEquals(m.fiber_g, 1);     // 有值的照比例縮
});
