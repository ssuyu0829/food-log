// ============================================================
// 產生 supabase/seed_drinks.sql
//
//   deno run --allow-write supabase/build_drinks.ts
//
// 2026-09-10 之前 seed_drinks.sql 是手打的數字，結果同一杯的熱量與糖
// 各自隱含不同的鮮奶量（鮮奶茶大杯：230 kcal ⇒ 352ml，20g 乳糖 ⇒ 425ml）。
// 現在改成在這裡寫「配方」，數字由 _shared/drink_model.ts 算出來，
// kcal 與糖從同一個 milk_ratio 推導，內部不可能再打架。
//
// ⚠️ 不要手改 seed_drinks.sql——改這一支的配方，然後重跑。
// ============================================================
import {
  compose,
  type Recipe,
  roundNutrients,
} from "./functions/_shared/drink_model.ts";

interface Row { brand: string; item: string; aliases: string[]; recipe: Recipe }

// 幾個反覆出現的配方，取名字比複製貼上安全
const 純茶: Recipe = {};
const 奶精奶茶: Recipe = { creamer_g: 28 };
const 鮮奶茶: Recipe = { milk_ratio: 0.45 };
const 珍珠奶茶: Recipe = { creamer_g: 28, toppings: ["珍珠"] };
const 波霸奶茶: Recipe = { creamer_g: 28, toppings: ["波霸"] };
const 檸檬茶: Recipe = { juice_ratio: 0.10, sugar_pct: 0.11 };
const 梅子綠: Recipe = { sugar_pct: 0.115, fixed_sugar_g: 8 };
const 多多綠: Recipe = { toppings: ["養樂多"], sugar_pct: 0.075 };
// 冬瓜露是熬好的糖磚，甜度調不動——點無糖的冬瓜茶還是甜的
const 冬瓜茶: Recipe = { fixed_sugar_g: 32, sugar_pct: 0.053 };
const 芋頭鮮奶: Recipe = { milk_ratio: 0.6, toppings: ["芋泥"], sugar_pct: 0.067 };
// 黑糖磚同理，而且這類杯子根本沒有茶底，幾乎整杯鮮奶
const 黑糖珍珠鮮奶: Recipe = { milk_ratio: 0.9, toppings: ["珍珠"], fixed_sugar_g: 30, sugar_pct: 0 };
const 楊枝甘露: Recipe = { milk_ratio: 0.5, juice_ratio: 0.35, toppings: ["西米"], fixed_sugar_g: 22, sugar_pct: 0.04 };
const 冰淇淋紅茶: Recipe = { toppings: ["冰淇淋"] };
const 拿鐵咖啡: Recipe = { milk_ratio: 0.6, sugar_pct: 0.08 };
const 歐蕾: Recipe = { milk_ratio: 0.5, sugar_pct: 0.084 };
// 可不可／茶湯會的「拿鐵」系列主打鮮奶下得重，用高一階的 milk_ratio
const 濃歐蕾: Recipe = { milk_ratio: 0.65, sugar_pct: 0.084 };

const ROWS: Row[] = [
  // ---------- 通用（品牌認不出來時的 fallback） ----------
  { brand: "通用", item: "紅茶", aliases: ["紅茶", "錫蘭紅茶", "阿薩姆紅茶", "古早味紅茶"], recipe: 純茶 },
  { brand: "通用", item: "綠茶", aliases: ["綠茶", "茉莉綠茶", "翠玉綠茶"], recipe: 純茶 },
  { brand: "通用", item: "青茶", aliases: ["青茶", "烏龍茶", "烏龍", "四季春", "四季春茶", "包種茶"], recipe: 純茶 },
  { brand: "通用", item: "奶茶", aliases: ["奶茶", "紅茶奶茶", "奶青", "茶奶"], recipe: 奶精奶茶 },
  // ⚠️ 2026-09-10：把單獨的「拿鐵」從這裡拿掉了。
  //    原本它在鮮奶茶的 aliases 裡，害「黑沃 拿鐵」（咖啡店）被算成鮮奶茶。
  //    改成茶飲店的講法（紅茶拿鐵／茶拿鐵）留在這裡，裸的「拿鐵」歸拿鐵咖啡。
  //    兩者在新模型下差不到 50 kcal，所以認錯的代價本來就不大。
  { brand: "通用", item: "鮮奶茶", aliases: ["鮮奶茶", "鮮奶紅茶", "鮮奶綠茶", "歐蕾", "厚奶茶", "紅茶拿鐵", "茶拿鐵", "紅茶歐蕾"], recipe: 鮮奶茶 },
  { brand: "通用", item: "珍珠奶茶", aliases: ["珍奶", "珍珠奶茶", "珍珠鮮奶茶"], recipe: 珍珠奶茶 },
  { brand: "通用", item: "波霸奶茶", aliases: ["波霸奶茶", "波霸奶", "黑波奶茶"], recipe: 波霸奶茶 },
  { brand: "通用", item: "檸檬紅茶", aliases: ["檸檬紅茶", "檸檬綠茶", "檸檬青茶", "檸檬茶"], recipe: 檸檬茶 },
  { brand: "通用", item: "水果茶", aliases: ["水果茶", "百香綠", "百香果綠茶", "柳橙綠", "金桔檸檬", "梅子綠"], recipe: { juice_ratio: 0.18, sugar_pct: 0.11 } },
  { brand: "通用", item: "冬瓜茶", aliases: ["冬瓜茶", "冬瓜檸檬", "冬瓜鮮奶"], recipe: 冬瓜茶 },
  { brand: "通用", item: "多多綠", aliases: ["多多綠", "養樂多綠", "多多檸檬", "養樂多"], recipe: 多多綠 },
  { brand: "通用", item: "芋頭鮮奶", aliases: ["芋頭鮮奶", "芋泥鮮奶", "芋見鮮奶", "大甲芋頭鮮奶"], recipe: 芋頭鮮奶 },
  { brand: "通用", item: "黑糖珍珠鮮奶", aliases: ["黑糖珍珠鮮奶", "青蛙撞奶", "黑糖鮮奶", "黑糖珍奶"], recipe: 黑糖珍珠鮮奶 },
  { brand: "通用", item: "楊枝甘露", aliases: ["楊枝甘露", "芒果楊枝甘露"], recipe: 楊枝甘露 },
  { brand: "通用", item: "美式咖啡", aliases: ["美式", "美式咖啡", "黑咖啡"], recipe: { sugar_pct: 0.08 } },
  { brand: "通用", item: "拿鐵咖啡", aliases: ["拿鐵咖啡", "咖啡拿鐵", "拿鐵咖", "拿鐵", "那提"], recipe: 拿鐵咖啡 },

  // ---------- 50嵐 ----------
  { brand: "50嵐", item: "四季春茶", aliases: ["四季春", "四季春茶", "四季青茶"], recipe: 純茶 },
  { brand: "50嵐", item: "珍珠奶茶", aliases: ["珍奶", "珍珠奶茶"], recipe: 珍珠奶茶 },
  { brand: "50嵐", item: "波霸奶茶", aliases: ["波霸奶茶", "波霸奶"], recipe: 波霸奶茶 },
  { brand: "50嵐", item: "四季奶青", aliases: ["四季奶青", "奶青"], recipe: 奶精奶茶 },
  { brand: "50嵐", item: "梅子綠茶", aliases: ["梅子綠", "梅子綠茶"], recipe: 梅子綠 },
  { brand: "50嵐", item: "冰淇淋紅茶", aliases: ["冰淇淋紅茶", "冰淇淋紅"], recipe: 冰淇淋紅茶 },

  // ---------- 清心福全 ----------
  { brand: "清心福全", item: "黃金烏龍", aliases: ["黃金烏龍", "黃金烏龍茶"], recipe: 純茶 },
  { brand: "清心福全", item: "珍珠奶茶", aliases: ["珍奶", "珍珠奶茶"], recipe: 珍珠奶茶 },
  { brand: "清心福全", item: "梅子綠茶", aliases: ["梅子綠", "梅子綠茶"], recipe: 梅子綠 },
  { brand: "清心福全", item: "多多綠", aliases: ["多多綠", "養樂多綠"], recipe: 多多綠 },

  // ---------- 可不可熟成紅茶 ----------
  { brand: "可不可", item: "熟成紅茶", aliases: ["熟成紅茶", "熟成紅"], recipe: 純茶 },
  { brand: "可不可", item: "白玉歐蕾", aliases: ["白玉歐蕾", "白玉", "白玉鮮奶茶"], recipe: { milk_ratio: 0.65, toppings: ["白玉"], sugar_pct: 0.084 } },
  { brand: "可不可", item: "太妃紅茶拿鐵", aliases: ["太妃紅茶拿鐵", "太妃拿鐵", "太妃紅"], recipe: { milk_ratio: 0.65, fixed_sugar_g: 14, sugar_pct: 0.078 } },
  { brand: "可不可", item: "春芽觀音拿鐵", aliases: ["春芽觀音拿鐵", "觀音拿鐵"], recipe: 濃歐蕾 },

  // ---------- 迷客夏 ----------
  { brand: "迷客夏", item: "娜杯紅茶", aliases: ["娜杯紅茶", "娜杯"], recipe: 純茶 },
  { brand: "迷客夏", item: "珍珠紅茶拿鐵", aliases: ["珍珠紅茶拿鐵", "珍珠拿鐵"], recipe: { milk_ratio: 0.65, toppings: ["珍珠"], sugar_pct: 0.084 } },
  { brand: "迷客夏", item: "大甲芋頭鮮奶", aliases: ["大甲芋頭鮮奶", "芋頭鮮奶", "芋頭牛奶"], recipe: 芋頭鮮奶 },
  { brand: "迷客夏", item: "黑糖珍珠鮮奶", aliases: ["黑糖珍珠鮮奶", "黑糖珍奶"], recipe: 黑糖珍珠鮮奶 },

  // ---------- CoCo 都可 ----------
  { brand: "CoCo", item: "珍珠奶茶", aliases: ["珍奶", "珍珠奶茶"], recipe: 珍珠奶茶 },
  { brand: "CoCo", item: "奶茶三兄弟", aliases: ["三兄弟", "奶茶三兄弟"], recipe: { creamer_g: 28, toppings: ["珍珠", "仙草", "布丁"] } },
  { brand: "CoCo", item: "百香雙響炮", aliases: ["百香雙響炮", "鮮百香雙響炮", "雙響炮"], recipe: { juice_ratio: 0.2, toppings: ["椰果"], sugar_pct: 0.115 } },
  { brand: "CoCo", item: "鮮檸檬茶", aliases: ["鮮檸檬茶", "檸檬茶"], recipe: 檸檬茶 },

  // ---------- 大苑子 ----------
  { brand: "大苑子", item: "鮮榨柳橙綠", aliases: ["鮮榨柳橙綠", "柳橙綠"], recipe: { juice_ratio: 0.45, sugar_pct: 0.08 } },
  { brand: "大苑子", item: "台灣鮮果茶", aliases: ["台灣鮮果茶", "鮮果茶"], recipe: { juice_ratio: 0.2, sugar_pct: 0.10 } },
  { brand: "大苑子", item: "冬瓜檸檬", aliases: ["冬瓜檸檬", "冬檸"], recipe: { fixed_sugar_g: 32, juice_ratio: 0.08, sugar_pct: 0.053 } },

  // ---------- 龜記茗品 ----------
  { brand: "龜記", item: "冰淇淋紅茶", aliases: ["冰淇淋紅茶", "冰淇淋紅"], recipe: 冰淇淋紅茶 },
  { brand: "龜記", item: "楊枝甘露", aliases: ["楊枝甘露"], recipe: 楊枝甘露 },
  { brand: "龜記", item: "黑糖粉粿鮮奶", aliases: ["黑糖粉粿鮮奶", "粉粿鮮奶"], recipe: { milk_ratio: 0.9, toppings: ["粉粿"], fixed_sugar_g: 28, sugar_pct: 0 } },

  // ---------- 麻古茶坊 ----------
  { brand: "麻古", item: "楊枝甘露", aliases: ["楊枝甘露"], recipe: 楊枝甘露 },
  { brand: "麻古", item: "芝芝莓果", aliases: ["芝芝莓果", "芝芝莓莓"], recipe: { juice_ratio: 0.35, toppings: ["奶蓋"], sugar_pct: 0.084 } },
  { brand: "麻古", item: "蜂蜜檸檬", aliases: ["蜂蜜檸檬", "蜜檸檬"], recipe: { juice_ratio: 0.10, sugar_pct: 0.115, fixed_sugar_g: 6 } },

  // ---------- 鮮茶道 ----------
  { brand: "鮮茶道", item: "珍珠奶茶", aliases: ["珍奶", "珍珠奶茶"], recipe: 珍珠奶茶 },
  { brand: "鮮茶道", item: "冬瓜檸檬", aliases: ["冬瓜檸檬", "冬檸"], recipe: { fixed_sugar_g: 32, juice_ratio: 0.08, sugar_pct: 0.053 } },

  // ---------- 一沐日 ----------
  { brand: "一沐日", item: "芋頭鮮奶", aliases: ["芋頭鮮奶", "芋泥鮮奶"], recipe: 芋頭鮮奶 },
  { brand: "一沐日", item: "綠茶", aliases: ["綠茶", "茉莉綠茶"], recipe: 純茶 },

  // ---------- 茶湯會 ----------
  { brand: "茶湯會", item: "觀音拿鐵", aliases: ["觀音拿鐵", "鐵觀音拿鐵"], recipe: 濃歐蕾 },
  { brand: "茶湯會", item: "珍珠奶茶", aliases: ["珍奶", "珍珠奶茶"], recipe: 珍珠奶茶 },
];

// ------------------------------------------------------------
// 配方 → 六個扁平欄位。
// 扁平欄位是「正常冰」的值，冰塊要進計算時走 recipe（見 drinks.ts 的 computeNutrition）。
// 保留扁平欄位是為了讓 PWA、report function 與 schema.sql 的 drink_nutrition() 都不用改。
// ------------------------------------------------------------
function flat(r: Recipe) {
  const at = (size: "M" | "L", sweet: string) => roundNutrients(compose(r, size, sweet, "正常冰"));
  const zM = at("M", "無糖"), fM = at("M", "全糖");
  const zL = at("L", "無糖"), fL = at("L", "全糖");
  return {
    base_kcal_m: zM.kcal, base_kcal_l: zL.kcal,
    sugar_g_full_m: Math.round((fM.sugar_g - zM.sugar_g) * 10) / 10,
    sugar_g_full_l: Math.round((fL.sugar_g - zL.sugar_g) * 10) / 10,
    base_sugar_g_m: zM.sugar_g, base_sugar_g_l: zL.sugar_g,
  };
}

// ------------------------------------------------------------
// 產生階段的防呆。
// 2026-09-10 拿新舊表對照時抓到：舊表的「冬瓜茶大杯無糖」寫 14 kcal / 45 g 糖，
// 但光那 45 g 糖就有 180 kcal——熱量根本沒把自帶的糖算進去，是**低估** 165 kcal。
// 這種錯人眼看不出來（兩個欄位分開看都很合理），所以擋在這裡。
// ------------------------------------------------------------
function assertConsistent(r: Row) {
  for (const size of ["M", "L"] as const) {
    for (const sweet of ["無糖", "全糖"]) {
      const n = roundNutrients(compose(r.recipe, size, sweet, "正常冰"));
      if (n.sugar_g * 4 > n.kcal + 1) {
        throw new Error(
          `${r.brand}/${r.item} ${size} ${sweet}：糖 ${n.sugar_g}g（${n.sugar_g * 4} kcal）` +
          `比總熱量 ${n.kcal} kcal 還多，配方一定寫錯了`,
        );
      }
      if (n.kcal < 0 || n.sugar_g < 0 || n.sodium_mg < 0) {
        throw new Error(`${r.brand}/${r.item} ${size} ${sweet}：出現負數`);
      }
    }
  }
}
ROWS.forEach(assertConsistent);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]) => q(`{${xs.map((x) => (/[,{}"\\ ]/.test(x) ? `"${x}"` : x)).join(",")}}`);

const values = ROWS.map((r) => {
  const f = flat(r.recipe);
  return `  (${q(r.brand)}, ${q(r.item)}, ${arr(r.aliases)},\n` +
    `   ${f.base_kcal_m}, ${f.base_kcal_l}, ${f.sugar_g_full_m}, ${f.sugar_g_full_l}, ` +
    `${f.base_sugar_g_m}, ${f.base_sugar_g_l},\n` +
    `   ${q(JSON.stringify(r.recipe))}::jsonb, 'estimated')`;
}).join(",\n");

const sql = `-- ============================================================
-- 手搖飲熱量表
--
-- 🤖 這份是**產生出來的，不要手改**。
--    改配方 → supabase/build_drinks.ts
--    改食材常數／冰塊比例 → supabase/functions/_shared/drink_model.ts
--    然後重跑：deno run --allow-write supabase/build_drinks.ts
--
-- 在 schema.sql 跑完之後執行。可重複執行（on conflict 更新）。
-- ============================================================
--
-- ⚠️ 誠實聲明：全部標記為 'estimated'（推估），不是官方標示。
--    2026-09-10 之前這些數字是手打的，同一杯的熱量與糖各自隱含不同的鮮奶量
--    （鮮奶茶大杯：230 kcal ⇒ 352ml 鮮奶，但 20g 乳糖 ⇒ 425ml，差 20%）。
--    現在改成從配方算，兩者由同一個 milk_ratio 推導，內部不可能再打架。
--    誤差預期 ±15%（原本的手打表是 ±25% 且內部不自洽）。
--
--    這份表的價值是「同一杯每次算出同一個數字」讓你看得出趨勢，
--    不是給你當精準營養標示用。查得到官方數字的杯子會走 Bot 的網搜 fallback
--    自動升級成 'searched' 並附上來源網址。
--
-- ⚠️ 扁平欄位（base_kcal_* 等）是「正常冰」的值。
--    去冰／熱飲的液體多 30%，那個要走 recipe 欄位即時算（見 _shared/drinks.ts）。
--
-- 🔴 2026-09-10 之前記的手搖熱量與這份**不可直接比較**（鮮奶茶類降了約 1/3）。
-- ============================================================

insert into drinks
  (brand, item, aliases,
   base_kcal_m, base_kcal_l, sugar_g_full_m, sugar_g_full_l,
   base_sugar_g_m, base_sugar_g_l, recipe, source_type)
values
${values}
on conflict (brand, item) do update set
  aliases        = excluded.aliases,
  base_kcal_m    = excluded.base_kcal_m,
  base_kcal_l    = excluded.base_kcal_l,
  sugar_g_full_m = excluded.sugar_g_full_m,
  sugar_g_full_l = excluded.sugar_g_full_l,
  base_sugar_g_m = excluded.base_sugar_g_m,
  base_sugar_g_l = excluded.base_sugar_g_l,
  recipe         = excluded.recipe,
  updated_at     = now()
where drinks.source_type = 'estimated';  -- 已被網搜升級成官方資料的不覆蓋

select count(*) || ' 筆飲料資料，其中 ' || count(recipe) || ' 筆有配方' as 結果 from drinks;
`;

await Deno.writeTextFile(new URL("./seed_drinks.sql", import.meta.url), sql);
console.error(`寫好了：${ROWS.length} 筆`);
