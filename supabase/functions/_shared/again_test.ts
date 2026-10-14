import { assertEquals } from "jsr:@std/assert@1";
import { AGAIN_LIMIT, normalizeTitle, recentDistinct } from "./again.ts";

const m = (id: number, title: string | null, kcal = 100) => ({ id, title, total_kcal: kcal });

Deno.test("再來一份：去重、保序、最近的在前", () => {
  const rows = [m(5, "鮮奶茶"), m(4, "排骨便當"), m(3, "鮮奶茶"), m(2, "滷肉飯"), m(1, "排骨便當")];
  assertEquals(recentDistinct(rows).map((r) => r.id), [5, 4, 2]);
});

Deno.test("再來一份：空白與大小寫差異算同一樣東西", () => {
  const rows = [m(3, " 鮮奶茶 "), m(2, "鮮奶茶"), m(1, "CoCo 奶茶"), m(0, "coco  奶茶")];
  assertEquals(recentDistinct(rows).map((r) => r.id), [3, 1]);
  assertEquals(normalizeTitle("  CoCo   奶茶 "), "coco 奶茶");
});

Deno.test("再來一份：空標題跳過", () => {
  const rows = [m(3, null), m(2, ""), m(1, "滷肉飯")];
  assertEquals(recentDistinct(rows).map((r) => r.id), [1]);
});

Deno.test("再來一份：關鍵字過濾", () => {
  const rows = [m(3, "50嵐 四季春 微糖 大"), m(2, "排骨便當"), m(1, "清心 鮮奶茶")];
  assertEquals(recentDistinct(rows, 8, "鮮奶茶").map((r) => r.id), [1]);
  assertEquals(recentDistinct(rows, 8, "便當").map((r) => r.id), [2]);
  assertEquals(recentDistinct(rows, 8, "牛肉麵"), []);
});

Deno.test("再來一份：最多 8 個", () => {
  const rows = Array.from({ length: 20 }, (_, i) => m(20 - i, `餐 ${i}`));
  assertEquals(recentDistinct(rows).length, AGAIN_LIMIT);
  assertEquals(recentDistinct(rows, 3).length, 3);
});
