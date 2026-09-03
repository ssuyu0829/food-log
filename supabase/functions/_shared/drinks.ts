// ============================================================
// 手搖飲：解析你打的字 → 查表 → 算熱量
// 「50嵐 四季春 微糖 大」→ { brand:50嵐, item:四季春茶, size:M/L, sweetness:微糖 }
// ============================================================
import { db } from "./db.ts";
import { searchDrinkCalories } from "./gemini.ts";

export const BRAND_ALIASES: Record<string, string[]> = {
  "50嵐":      ["50嵐", "50岚", "五十嵐", "五十岚", "50lan"],
  "清心福全":  ["清心福全", "清心"],
  "可不可":    ["可不可熟成紅茶", "可不可", "kebuke"],
  "迷客夏":    ["迷客夏", "milkshop", "迷客夏MilkShop"],
  "CoCo":      ["coco都可", "coco", "都可"],
  "大苑子":    ["大苑子"],
  "龜記":      ["龜記茗品", "龜記"],
  "麻古":      ["麻古茶坊", "麻古"],
  "鮮茶道":    ["鮮茶道"],
  "一沐日":    ["一沐日"],
  "茶湯會":    ["茶湯會"],
};

// 這些字出現時，幾乎可以確定在講一杯手搖
const DRINK_SIGNALS = /無糖|去糖|微糖|半糖|少糖|全糖|正常糖|[一二三四五六七八九0-9]\s*分糖|去冰|微冰|少冰|正常冰|溫的|熱的|大杯|中杯|珍珠|波霸|奶茶|鮮奶茶|拿鐵|歐蕾|手搖/;

const SWEET_PATTERNS: [RegExp, string][] = [
  [/無糖|去糖|不加糖|零糖|0\s*分糖/, "無糖"],
  [/微糖|一分糖|1\s*分糖/,           "微糖"],
  [/二分糖|2\s*分糖/,                "二分糖"],
  [/三分糖|3\s*分糖/,                "三分糖"],
  [/半糖|五分糖|5\s*分糖/,           "半糖"],
  [/少糖|七分糖|7\s*分糖/,           "少糖"],
  [/八分糖|8\s*分糖/,                "八分糖"],
  [/全糖|正常糖|標準糖/,             "全糖"],
];

const ICE_PATTERNS: [RegExp, string][] = [
  [/熱的|熱飲|溫的|溫熱/, "熱"],
  [/去冰|完全去冰/,       "去冰"],
  [/微冰/,                "微冰"],
  [/少冰/,                "少冰"],
  [/正常冰|全冰/,         "正常冰"],
];

export interface ParsedDrink {
  brand: string | null;      // 認出來的品牌（canonical），認不出來是 null
  brandRaw: string | null;   // 你原本打的品牌字樣
  itemText: string;          // 扣掉品牌/甜度/冰塊/杯型之後剩下的品名
  size: "M" | "L";
  sweetness: string;
  ice: string | null;
  looksLikeDrink: boolean;
}

function normalize(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全形→半形
    .replace(/[,，、。.／/｜|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDrink(input: string): ParsedDrink {
  let s = normalize(input);
  const lower = s.toLowerCase();

  // 1. 品牌
  let brand: string | null = null;
  let brandRaw: string | null = null;
  outer: for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    for (const a of [...aliases].sort((x, y) => y.length - x.length)) {
      const i = lower.indexOf(a.toLowerCase());
      if (i >= 0) {
        brand = canon;
        brandRaw = s.slice(i, i + a.length);
        s = (s.slice(0, i) + " " + s.slice(i + a.length)).trim();
        break outer;
      }
    }
  }

  // 2. 甜度（先比對長的，避免「微糖」被「糖」誤吃）
  //    沒講甜度時當「無糖」——使用者的常態就是無糖鮮奶茶，
  //    講了甜度反而是例外。認得出來的字串一律照字串走。
  let sweetness = "無糖";
  let sweetFound = false;
  for (const [re, label] of SWEET_PATTERNS) {
    const m = s.match(re);
    if (m) { sweetness = label; sweetFound = true; s = s.replace(re, " "); break; }
  }

  // 3. 冰塊
  let ice: string | null = null;
  for (const [re, label] of ICE_PATTERNS) {
    const m = s.match(re);
    if (m) { ice = label; s = s.replace(re, " "); break; }
  }

  // 4. 杯型。注意順序：先吃掉「大杯/中杯」再處理單字的「大/中/小」
  let size: "M" | "L" = "M";
  if (/大杯|特大|700|L號/i.test(s)) { size = "L"; s = s.replace(/大杯|特大|700\s*(cc|ml)?|L號/gi, " "); }
  else if (/中杯|小杯|500|M號/i.test(s)) { size = "M"; s = s.replace(/中杯|小杯|500\s*(cc|ml)?|M號/gi, " "); }
  else if (/(^|\s)(大|L)(\s|$)/i.test(s)) { size = "L"; s = s.replace(/(^|\s)(大|L)(\s|$)/i, " "); }
  else if (/(^|\s)(中|小|M)(\s|$)/i.test(s)) { size = "M"; s = s.replace(/(^|\s)(中|小|M)(\s|$)/i, " "); }

  const itemText = normalize(s);
  return {
    brand, brandRaw, itemText, size, sweetness, ice,
    looksLikeDrink: !!brand || sweetFound || DRINK_SIGNALS.test(input),
  };
}

// ------------------------------------------------------------

export interface DrinkRow {
  id: number; brand: string; item: string; aliases: string[];
  base_kcal_m: number; base_kcal_l: number;
  sugar_g_full_m: number; sugar_g_full_l: number;
  base_sugar_g_m: number; base_sugar_g_l: number;
  source_type: string; source_url: string | null;
}

export const SWEET_FACTOR: Record<string, number> = {
  "無糖": 0, "微糖": 0.15, "二分糖": 0.2, "三分糖": 0.3,
  "半糖": 0.5, "少糖": 0.7, "八分糖": 0.8, "全糖": 1.0,
};

export function computeNutrition(row: DrinkRow, size: "M" | "L", sweetness: string) {
  const f = SWEET_FACTOR[sweetness] ?? 1.0;
  const baseKcal  = size === "L" ? row.base_kcal_l : row.base_kcal_m;
  const sugarFull = size === "L" ? row.sugar_g_full_l : row.sugar_g_full_m;
  const baseSugar = size === "L" ? row.base_sugar_g_l : row.base_sugar_g_m;
  return {
    kcal: Math.round(Number(baseKcal) + Number(sugarFull) * f * 4),
    sugar_g: Math.round((Number(baseSugar) + Number(sugarFull) * f) * 10) / 10,
  };
}

/** 在候選列裡找最像 itemText 的一筆 */
function bestMatch(rows: DrinkRow[], itemText: string): DrinkRow | null {
  if (!itemText) return null;
  const t = itemText.toLowerCase().replace(/\s/g, "");
  let best: DrinkRow | null = null, bestScore = 0;

  for (const r of rows) {
    const names = [r.item, ...(r.aliases ?? [])].map((n) => n.toLowerCase().replace(/\s/g, ""));
    let score = 0;
    for (const n of names) {
      if (!n) continue;
      if (n === t) score = Math.max(score, 100);
      else if (t.includes(n)) score = Math.max(score, 60 + n.length * 2);
      else if (n.includes(t)) score = Math.max(score, 50 + t.length * 2);
      else {
        // 共同字元數（中文沒有詞邊界，逐字比最實際）
        const common = [...new Set(t)].filter((c) => n.includes(c)).length;
        if (common >= 2) score = Math.max(score, common * 8);
      }
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 24 ? best : null;
}

export interface DrinkResult {
  row: DrinkRow | null;
  kcal: number;
  sugar_g: number;
  title: string;
  sourceType: "official" | "searched" | "estimated" | "generic";
  sourceUrl: string | null;
  note: string;
}

/**
 * 查一杯飲料。順序：品牌專屬 → 通用 → 網搜 → 放棄。
 * 每一層都會誠實回報數字是哪裡來的。
 */
export async function lookupDrink(p: ParsedDrink): Promise<DrinkResult | null> {
  const { data } = await db.from("drinks").select("*");
  const all = (data ?? []) as DrinkRow[];

  const label = [p.brandRaw ?? p.brand, p.itemText, p.sweetness, p.size === "L" ? "大" : "中"]
    .filter(Boolean).join(" ");

  // 第 1 層：品牌專屬
  if (p.brand) {
    const hit = bestMatch(all.filter((r) => r.brand === p.brand), p.itemText);
    if (hit) return build(hit, p, label, "");
  }

  // 第 2 層：通用品項
  const generic = bestMatch(all.filter((r) => r.brand === "通用"), p.itemText);
  if (generic) {
    const note = p.brand
      ? `${p.brand}沒有這個品項的資料，用通用「${generic.item}」估算`
      : "用通用品項估算，沒有對到特定品牌";
    return build(generic, p, label, note);
  }

  // 第 3 層：上網找官方熱量表
  if (p.brand && p.itemText) {
    const found = await searchDrinkCalories(p.brand, p.itemText, p.size, p.sweetness);
    if (found) {
      await cacheSearched(p, found);
      return {
        row: null, kcal: found.kcal, sugar_g: found.sugar_g, title: label,
        sourceType: "searched", sourceUrl: found.source_url,
        note: "第一次遇到這杯，剛上網查到並存起來了，下次會直接秒回",
      };
    }
  }

  return null; // 交給呼叫端決定要不要丟給 AI 用文字估
}

function build(row: DrinkRow, p: ParsedDrink, label: string, note: string): DrinkResult {
  const n = computeNutrition(row, p.size, p.sweetness);
  return {
    row, kcal: n.kcal, sugar_g: n.sugar_g, title: label,
    sourceType: row.source_type as DrinkResult["sourceType"],
    sourceUrl: row.source_url, note,
  };
}

/**
 * 把網搜結果寫回表裡。要把「一杯的熱量」反推回 base + 糖水，
 * 才能讓之後點不同甜度時算得出來。
 */
async function cacheSearched(
  p: ParsedDrink,
  found: { kcal: number; sugar_g: number; source_url: string },
) {
  const f = SWEET_FACTOR[p.sweetness] ?? 1.0;
  // 假設查到的糖量裡，可調整的糖水佔 f 那一份；f=0（無糖）時反推不了，就整份當固定糖
  const sugarFull = f > 0 ? found.sugar_g / f : 0;
  const baseSugar = f > 0 ? 0 : found.sugar_g;
  const baseKcal = Math.max(0, found.kcal - sugarFull * f * 4);
  const ratio = p.size === "L" ? 700 / 500 : 500 / 700; // 換算另一種杯型

  const row = p.size === "L"
    ? { base_kcal_l: baseKcal, base_kcal_m: baseKcal * (500 / 700),
        sugar_g_full_l: sugarFull, sugar_g_full_m: sugarFull * (500 / 700),
        base_sugar_g_l: baseSugar, base_sugar_g_m: baseSugar * (500 / 700) }
    : { base_kcal_m: baseKcal, base_kcal_l: baseKcal * (700 / 500),
        sugar_g_full_m: sugarFull, sugar_g_full_l: sugarFull * (700 / 500),
        base_sugar_g_m: baseSugar, base_sugar_g_l: baseSugar * (700 / 500) };
  void ratio;

  await db.from("drinks").upsert({
    brand: p.brand!, item: p.itemText, aliases: [p.itemText],
    ...round(row), source_type: "searched", source_url: found.source_url,
    updated_at: new Date().toISOString(),
  }, { onConflict: "brand,item" });
}

const round = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
