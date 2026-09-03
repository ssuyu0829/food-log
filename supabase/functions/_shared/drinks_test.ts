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
  assertEquals(p.size, "L");          // 沒講杯型＝大杯
  assertEquals(p.sweetness, "半糖");
  assertEquals(p.ice, "去冰");
  assertEquals(p.itemText, "珍奶");
  assertEquals(p.looksLikeDrink, true);
});

Deno.test("解析：沒講甜度就當無糖（使用者的常態）", () => {
  const p = parseDrink("清心 多多綠");
  assertEquals(p.brand, "清心福全");
  assertEquals(p.sweetness, "無糖");
});

Deno.test("解析：最常喝的『鮮奶茶』只打三個字也要成立", () => {
  const p = parseDrink("鮮奶茶");
  assertEquals(p.looksLikeDrink, true);
  assertEquals(p.sweetness, "無糖");   // 沒講甜度＝無糖
  assertEquals(p.size, "L");           // 沒講杯型＝大杯
  assertEquals(p.itemText, "鮮奶茶");
});

Deno.test("解析：講了中杯就是中杯，不會被大杯預設值蓋掉", () => {
  assertEquals(parseDrink("鮮奶茶 中杯").size, "M");
  assertEquals(parseDrink("鮮奶茶 小").size, "M");
  assertEquals(parseDrink("紅茶 500cc").size, "M");
  assertEquals(parseDrink("紅茶 M").size, "M");
});

Deno.test("解析：講了甜度就照講的走，不會被預設值蓋掉", () => {
  assertEquals(parseDrink("鮮奶茶 半糖").sweetness, "半糖");
  assertEquals(parseDrink("鮮奶茶全糖大").sweetness, "全糖");
});

Deno.test("解析：「去冰」不可以被當成「去糖」", () => {
  const p = parseDrink("紅茶去冰");
  assertEquals(p.sweetness, "無糖");   // 沒講甜度的預設值，不是因為讀到「去」
  assertEquals(p.ice, "去冰");
  assertEquals(parseDrink("紅茶全糖去冰").sweetness, "全糖");  // 有講就照講的
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

Deno.test("熱量：有講但看不懂的甜度字串仍當全糖（寧可高估）", () => {
  assertEquals(computeNutrition(珍奶, "M", "隨便").kcal, computeNutrition(珍奶, "M", "全糖").kcal);
});

Deno.test("常態路徑：無糖鮮奶茶", () => {
  const 鮮奶茶: DrinkRow = {
    id: 2, brand: "通用", item: "鮮奶茶", aliases: ["鮮奶紅茶", "歐蕾"],
    base_kcal_m: 165, base_kcal_l: 230,
    sugar_g_full_m: 36, sugar_g_full_l: 50,
    base_sugar_g_m: 14, base_sugar_g_l: 20,
    source_type: "estimated", source_url: null,
  };
  const p = parseDrink("鮮奶茶");
  const n = computeNutrition(鮮奶茶, p.size, p.sweetness);
  assertEquals(n.kcal, 230);     // 大杯、只有鮮奶與茶的熱量，沒有糖水
  assertEquals(n.sugar_g, 20);   // 乳糖，不是加的糖

  const m = computeNutrition(鮮奶茶, "M", "無糖");
  assertEquals(m.kcal, 165);     // 明講中杯時才會是中杯的數字
});
