// ============================================================
// 辨識引擎的唯一抽換點。
// 要換成 Claude / OpenAI，只要改這個檔，讓它一樣導出
// analyzeFood() 與 searchDrinkCalories() 就好，其他檔案都不用動。
// ============================================================
import { GEMINI_API_KEY, GEMINI_MODEL } from "./env.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface FoodItem {
  name: string; qty_desc: string;
  kcal: number; protein_g: number; fat_g: number; carb_g: number; sugar_g: number;
}
export interface FoodAnalysis {
  is_food: boolean;
  title: string;
  items: FoodItem[];
  total_kcal: number; protein_g: number; fat_g: number; carb_g: number; sugar_g: number;
  confidence: "high" | "medium" | "low";
  note: string;
  model: string;
}

const SYSTEM = `你是一位台灣的營養分析助手，服務對象是一位想監督自己日常飲食的成年人。

規則：
1. 用台灣的食物名稱與常見份量（碗、便當、片、杯、份）。
2. 逐項拆開列出。例如一個排骨便當要拆成：白飯、排骨、配菜、滷蛋。
3. 份量看不出來時，用台灣一般外食的標準份量推估，不要拒答。
4. confidence 誠實給：
   - high  = 包裝食品可看到標示，或是份量明確的單一品項
   - medium= 常見外食、份量可從餐具／容器推估
   - low   = 份量難判斷、被遮住、混合料理看不出用油量
5. note 用一句繁體中文說明最不確定的地方（例如「看不出便當有沒有淋滷汁，油量可能低估」）。沒有特別要說的就給空字串。
6. 如果照片裡根本沒有食物或飲料，is_food 設 false，其他欄位給 0 或空。
7. 熱量寧可略高估也不要低估——這是用來監督飲食的，低估會讓使用者失去警覺。
8. 全部數值用整數（sugar_g 可以一位小數）。`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_food: { type: "BOOLEAN" },
    title: { type: "STRING", description: "整餐的一句話名稱，例如「排骨便當」" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          qty_desc: { type: "STRING", description: "份量描述，例如「1 碗（約200g）」" },
          kcal: { type: "NUMBER" }, protein_g: { type: "NUMBER" },
          fat_g: { type: "NUMBER" }, carb_g: { type: "NUMBER" }, sugar_g: { type: "NUMBER" },
        },
        required: ["name", "qty_desc", "kcal", "protein_g", "fat_g", "carb_g", "sugar_g"],
      },
    },
    total_kcal: { type: "NUMBER" }, protein_g: { type: "NUMBER" },
    fat_g: { type: "NUMBER" }, carb_g: { type: "NUMBER" }, sugar_g: { type: "NUMBER" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    note: { type: "STRING" },
  },
  required: ["is_food", "title", "items", "total_kcal", "protein_g", "fat_g", "carb_g", "sugar_g", "confidence", "note"],
};

async function generate(body: unknown, model = GEMINI_MODEL): Promise<any> {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 400)}`);
  }
  return await res.json();
}

function textOf(resp: any): string {
  return (resp?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? "").join("").trim();
}

/** 從可能夾雜 markdown 圍欄的字串裡挖出第一個 JSON 物件 */
function looseJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`回應裡找不到 JSON：${s.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * 辨識一餐。照片、文字，或兩者都給（文字會被當成補充提示）。
 */
export async function analyzeFood(
  opts: { image?: { bytes: Uint8Array; mime: string }; text?: string },
): Promise<FoodAnalysis> {
  const parts: unknown[] = [];

  if (opts.image) {
    parts.push({
      inline_data: {
        mime_type: opts.image.mime,
        data: base64(opts.image.bytes),
      },
    });
  }
  if (opts.image && opts.text) {
    parts.push({ text: `這張照片的補充說明（請優先採信）：${opts.text}` });
  } else if (opts.image) {
    parts.push({ text: "分析這張照片裡的食物或飲料。" });
  } else {
    parts.push({ text: `分析這段文字描述的餐點：${opts.text}` });
  }

  const resp = await generate({
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    },
  });

  const raw = looseJson(textOf(resp)) as FoodAnalysis;
  return normalize(raw);
}

/** 把模型可能給的怪值收乾淨，並讓 total 與 items 對得起來 */
function normalize(a: any): FoodAnalysis {
  const items: FoodItem[] = (a.items ?? []).map((i: any) => ({
    name: String(i.name ?? "").slice(0, 60),
    qty_desc: String(i.qty_desc ?? ""),
    kcal: num(i.kcal), protein_g: num(i.protein_g), fat_g: num(i.fat_g),
    carb_g: num(i.carb_g), sugar_g: num(i.sugar_g),
  }));
  const sum = (k: keyof FoodItem) => items.reduce((s, i) => s + (i[k] as number), 0);
  // 明細加總比模型自己填的 total 可信，差超過 10% 就以明細為準
  const itemKcal = sum("kcal");
  const total = num(a.total_kcal);
  const useItems = items.length > 0 && (total === 0 || Math.abs(total - itemKcal) / Math.max(total, 1) > 0.1);

  return {
    is_food: a.is_food !== false,
    title: String(a.title ?? "未命名").slice(0, 60),
    items,
    total_kcal: Math.round(useItems ? itemKcal : total),
    protein_g: Math.round(items.length ? sum("protein_g") : num(a.protein_g)),
    fat_g:     Math.round(items.length ? sum("fat_g")     : num(a.fat_g)),
    carb_g:    Math.round(items.length ? sum("carb_g")    : num(a.carb_g)),
    sugar_g:   Math.round((items.length ? sum("sugar_g")  : num(a.sugar_g)) * 10) / 10,
    confidence: ["high", "medium", "low"].includes(a.confidence) ? a.confidence : "low",
    note: String(a.note ?? ""),
    model: GEMINI_MODEL,
  };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * 手搖飲查不到時的網搜 fallback：用 Google Search grounding 找官方熱量表。
 * 注意：開了 google_search 就不能用 responseSchema，所以只能請它輸出 JSON 再寬鬆解析。
 * 找不到可信來源時回 null——寧可回 null 走通用公式，也不要編一個數字。
 */
export async function searchDrinkCalories(
  brand: string, item: string, size: "M" | "L", sweetness: string,
): Promise<{ kcal: number; sugar_g: number; source_url: string } | null> {
  const q = `查「${brand} ${item}」這杯台灣手搖飲的官方營養標示。
容量：${size === "L" ? "大杯約700cc" : "中杯約500cc"}，甜度：${sweetness}。

請搜尋該品牌官網、官方熱量表、或政府/媒體引用官方數據的頁面。
只輸出這個 JSON，不要其他文字：
{"found": true/false, "kcal": 數字, "sugar_g": 數字, "source_url": "網址", "why": "一句話說明這個數字的依據"}

找不到可信來源，或只找到網友猜測，就回 {"found": false}。不要自己編數字。`;

  try {
    const resp = await generate({
      contents: [{ role: "user", parts: [{ text: q }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 },
    });
    const j = looseJson(textOf(resp));
    if (!j.found || !j.source_url || !Number.isFinite(Number(j.kcal))) return null;
    return {
      kcal: Math.round(Number(j.kcal)),
      sugar_g: Math.round(Number(j.sugar_g ?? 0) * 10) / 10,
      source_url: String(j.source_url),
    };
  } catch (e) {
    console.error("searchDrinkCalories 失敗（會退回通用公式）:", e);
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
