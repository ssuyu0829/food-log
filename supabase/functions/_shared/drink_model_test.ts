// 手搖配方模型的測試。這支不碰 db，所以跑法乾淨：
//   deno test supabase/functions/_shared/drink_model_test.ts
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { compose, type Recipe, roundNutrients, TOPPINGS } from "./drink_model.ts";

const 鮮奶茶: Recipe = { milk_ratio: 0.45 };
const 奶茶:   Recipe = { creamer_g: 28 };
const 珍奶:   Recipe = { creamer_g: 28, toppings: ["珍珠"] };

// ------------------------------------------------------------
// 🔴 這一組是整個改動的理由。舊表的通用/鮮奶茶大杯是 230 kcal、乳糖 20 g，
//    而 230 kcal 隱含 352 ml 鮮奶、20 g 乳糖隱含 425 ml，自己就差 20%。
//    700cc 杯正常冰只有 525 ml 液體，鮮奶佔 45% ⇒ 236 ml，
//    合理值是 150–170 kcal / 10–12 g 乳糖。
// ------------------------------------------------------------
Deno.test("鮮奶茶 大杯 正常冰 無糖 落在 150–170 kcal（舊值 230 要測失敗）", () => {
  const n = roundNutrients(compose(鮮奶茶, "L", "無糖", "正常冰"));
  assert(n.kcal >= 150 && n.kcal <= 170, `kcal = ${n.kcal}，不在 150–170`);
  assert(n.sugar_g >= 10 && n.sugar_g <= 12, `乳糖 = ${n.sugar_g}，不在 10–12`);
  assert(n.kcal < 230, "沒有比舊值低就等於這次改動沒生效");
});

Deno.test("鮮奶茶 無糖：sugar_g 是乳糖所以 > 0，但 added_sugar_g 必須是 0", () => {
  const n = roundNutrients(compose(鮮奶茶, "L", "無糖"));
  assert(n.sugar_g > 0, "鮮奶本來就有乳糖，不該顯示 0");
  assertEquals(n.added_sugar_g, 0);
  // 這正是舊報表最誤導的地方：平均糖 77 g/天 裡有一大塊是乳糖，
  // 不能拿去對 WHO 的「游離糖 < 50 g」門檻。
});

Deno.test("沒講冰塊時等於正常冰", () => {
  assertEquals(compose(鮮奶茶, "L", "無糖", null).kcal,
               compose(鮮奶茶, "L", "無糖", "正常冰").kcal);
});

Deno.test("去冰比正常冰高約 30%（液體變多）", () => {
  const 正常 = compose(鮮奶茶, "L", "無糖", "正常冰").kcal;
  const 去冰 = compose(鮮奶茶, "L", "無糖", "去冰").kcal;
  assertAlmostEquals(去冰 / 正常, 1.29, 0.03);
});

Deno.test("去冰全糖的糖也跟著變多（糖水是照液體量下的）", () => {
  const 正常 = compose(奶茶, "L", "全糖", "正常冰").added_sugar_g;
  const 去冰 = compose(奶茶, "L", "全糖", "去冰").added_sugar_g;
  assert(去冰 > 正常, "去冰的糖水應該比較多");
});

// ------------------------------------------------------------
// 🔴 最容易寫錯的一條：配料是**舀的固定一份**，不隨冰塊縮放。
//    去冰只會讓液體變多，不會讓珍珠變多。
// ------------------------------------------------------------
Deno.test("珍奶去冰時，珍珠那份熱量完全不動", () => {
  const t = TOPPINGS["珍珠"];
  const 珍珠熱量L = t.per100.kcal * (t.g * 1.35) / 100;

  const 正常 = compose(珍奶, "L", "無糖", "正常冰");
  const 去冰 = compose(珍奶, "L", "無糖", "去冰");
  // 兩杯的差全部來自液體（奶精是舀的也不變），所以差值不含珍珠
  const 差 = 去冰.kcal - 正常.kcal;
  assert(差 > 0, "去冰應該比較多液體");
  assert(差 < 珍珠熱量L, `差 ${差.toFixed(0)} kcal 不該大到像多了一份珍珠（${珍珠熱量L.toFixed(0)}）`);
});

Deno.test("配料佔掉杯內體積，所以珍奶的糖水比同杯型純奶茶少", () => {
  const 奶茶糖 = compose(奶茶, "L", "全糖").added_sugar_g;
  const 珍奶糖水 = compose(珍奶, "L", "全糖").added_sugar_g
                  - compose(珍奶, "L", "無糖").added_sugar_g;
  const 奶茶糖水 = 奶茶糖 - compose(奶茶, "L", "無糖").added_sugar_g;
  assert(珍奶糖水 < 奶茶糖水, "珍珠佔掉體積，糖水應該比較少");
});

Deno.test("甜度：無糖 < 半糖 < 全糖，且無糖那杯完全沒有糖水", () => {
  const z = compose(奶茶, "M", "無糖");
  const h = compose(奶茶, "M", "半糖");
  const f = compose(奶茶, "M", "全糖");
  assert(z.kcal < h.kcal && h.kcal < f.kcal);
  // 半糖剛好是全糖糖水的一半
  assertAlmostEquals(f.added_sugar_g - z.added_sugar_g,
                     (h.added_sugar_g - z.added_sugar_g) * 2, 0.1);
});

Deno.test("認不得的甜度字串當全糖（寧可高估糖，不要低估）", () => {
  assertEquals(compose(奶茶, "M", "隨便講的").kcal, compose(奶茶, "M", "全糖").kcal);
});

Deno.test("大杯比中杯多，但不是線性放大（勺子的東西只 ×1.35）", () => {
  const m = compose(珍奶, "M", "全糖").kcal;
  const l = compose(珍奶, "L", "全糖").kcal;
  assert(l > m);
  assert(l / m < 700 / 500 * 1.05, "不該整杯照杯容積等比例放大");
});

Deno.test("固定糖（黑糖磚）：點無糖還是有糖", () => {
  const 黑糖珍奶: Recipe = { creamer_g: 20, toppings: ["珍珠"], fixed_sugar_g: 18, sugar_pct: 0 };
  const n = compose(黑糖珍奶, "M", "無糖");
  assert(n.added_sugar_g > 15, "黑糖磚不會因為點無糖就消失");
});

Deno.test("鈉：鮮奶茶不是 0（鮮奶本身就有鈉）", () => {
  const n = roundNutrients(compose(鮮奶茶, "L", "無糖"));
  assert(n.sodium_mg > 50, `鈉 = ${n.sodium_mg}`);
});

Deno.test("奶精奶茶的飽和脂肪明顯高於同杯鮮奶茶（氫化植物油）", () => {
  const a = compose(奶茶, "L", "無糖").sat_fat_g;
  const b = compose(鮮奶茶, "L", "無糖").sat_fat_g;
  assert(a > b, `奶精 ${a.toFixed(1)} 應該 > 鮮奶 ${b.toFixed(1)}`);
});

Deno.test("純茶幾乎沒有熱量，但無糖也不是剛好 0", () => {
  const n = roundNutrients(compose({}, "L", "無糖"));
  assert(n.kcal > 0 && n.kcal < 15, `純茶 ${n.kcal} kcal`);
});

Deno.test("未知配料要當場丟錯，不要靜靜算成 0", () => {
  let threw = false;
  try { compose({ toppings: ["不存在的料"] }, "M", "無糖"); } catch { threw = true; }
  assert(threw);
});
