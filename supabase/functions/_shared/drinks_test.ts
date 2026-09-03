// 手搖解析與熱量公式的測試。不需要任何金鑰或網路。
// 跑法：deno test --allow-env supabase/functions/_shared/drinks_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { computeNutrition, type DrinkRow, parseDrink } from "./drinks.ts";

Deno.test("解析：完整格式", () => {
  const p = parseDrink("50嵐 四季春 微糖 大");
  assertEquals(p.brand, "50嵐");
  assertEquals(p.itemText, "四季春");
  assertEquals(p.size, "L");
  assertEquals(p.sweetness, "微糖");
  assertEquals(p.looksLikeDrink, true);
});

Deno.test("解析：沒有空格也要能拆", () => {
  const p = parseDrink("50嵐四季春微糖大杯");
  assertEquals(p.brand, "50嵐");
  assertEquals(p.size, "L");
  assertEquals(p.sweetness, "微糖");
  assertEquals(p.itemText, "四季春");
});

Deno.test("解析：沒講品牌與杯型時的預設值", () => {
  const p = parseDrink("珍奶半糖去冰");
  assertEquals(p.brand, null);
  assertEquals(p.size, "M");          // 預設中杯
  assertEquals(p.sweetness, "半糖");
  assertEquals(p.ice, "去冰");
  assertEquals(p.itemText, "珍奶");
  assertEquals(p.looksLikeDrink, true);
});

Deno.test("解析：沒講甜度就當全糖（寧可高估）", () => {
  const p = parseDrink("清心 多多綠");
  assertEquals(p.brand, "清心福全");
  assertEquals(p.sweetness, "全糖");
});

Deno.test("解析：「去冰」不可以被當成「去糖」", () => {
  const p = parseDrink("紅茶去冰");
  assertEquals(p.sweetness, "全糖");
  assertEquals(p.ice, "去冰");
});

Deno.test("解析：全形數字與標點", () => {
  const p = parseDrink("ＣｏＣｏ，珍珠奶茶，７分糖，大");
  assertEquals(p.brand, "CoCo");
  assertEquals(p.sweetness, "少糖");
  assertEquals(p.size, "L");
});

Deno.test("解析：不是飲料的東西不要被誤判", () => {
  assertEquals(parseDrink("滷肉飯 一碗").looksLikeDrink, false);
  assertEquals(parseDrink("麥當勞大薯").looksLikeDrink, false);
  assertEquals(parseDrink("排骨便當").looksLikeDrink, false);
});

// ------------------------------------------------------------

const 珍奶: DrinkRow = {
  id: 1, brand: "通用", item: "珍珠奶茶", aliases: ["珍奶"],
  base_kcal_m: 280, base_kcal_l: 385,
  sugar_g_full_m: 36, sugar_g_full_l: 50,
  base_sugar_g_m: 26, base_sugar_g_l: 35,
  source_type: "estimated", source_url: null,
};

Deno.test("熱量：大杯全糖珍奶 = 底 385 + 50g 糖 x 4", () => {
  const n = computeNutrition(珍奶, "L", "全糖");
  assertEquals(n.kcal, 585);
  assertEquals(n.sugar_g, 85);   // 珍珠自帶 35 + 糖水 50
});

Deno.test("熱量：無糖珍奶的糖不會是 0（珍珠本身就是糖）", () => {
  const n = computeNutrition(珍奶, "L", "無糖");
  assertEquals(n.kcal, 385);
  assertEquals(n.sugar_g, 35);
});

Deno.test("熱量：半糖剛好是糖水的一半", () => {
  const full = computeNutrition(珍奶, "M", "全糖");
  const half = computeNutrition(珍奶, "M", "半糖");
  const zero = computeNutrition(珍奶, "M", "無糖");
  assertEquals(full.kcal - zero.kcal, 144);        // 36g x 4
  assertEquals(half.kcal - zero.kcal, 72);         // 一半
  assertEquals(half.sugar_g, 26 + 18);
});

Deno.test("熱量：看不懂的甜度字串一律當全糖", () => {
  assertEquals(computeNutrition(珍奶, "M", "隨便").kcal, computeNutrition(珍奶, "M", "全糖").kcal);
});
