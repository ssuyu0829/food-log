// ============================================================
// 體重 → 熱量估計的校準。**純函式，刻意不 import db.ts**
// （所以 weight_test.ts 不需要環境變數，比照 portion.ts / drink_model.ts）。
//
// 為什麼需要這一支
// ----------------
// 2026-09-10 使用者說「熱量看起來偏高估」。查下去確實找到兩個結構性偏差
// （prompt 寫著「寧可高估」、鮮奶茶的奶量算多了），但那都是**推理**出來的，
// 沒有任何外部證據能說「到底差幾 %」。體重是唯一的外部錨。
//
// 🔴 這支能回答什麼、不能回答什麼（很重要，不要在訊息裡講超過這條線）
// ----------------------------------------------------------------
// 體重變化只定得出一件事：**真實攝取 − 真實 TDEE**。
// 而 TDEE 是未知的，所以**沒辦法**單靠體重算出「AI 高估了幾 %」。
// 硬要算的話，那個數字會同時混進三個來源，而且方向還相反：
//   (a) AI 高估      → 讓記錄攝取偏高
//   (b) 漏記         → 讓記錄攝取偏低   ← 跟 (a) 相反，會互相抵銷
//   (c) 個人 TDEE 與公式的差
// 所以這支只回報**「由體重反推的 TDEE」**（＝記錄攝取 − 體重推得的每日盈餘），
// 讓那個數字合不合理由人來判斷；要給比值時，一定要有使用者自己提供的參考 TDEE。
// 這是刻意不做成一個看起來很精確的百分比。
// ============================================================

/** 1 公斤體重變化 ≈ 7700 kcal。這是脂肪組織的通用換算，短期會被水分干擾。 */
export const KCAL_PER_KG = 7700;

/** 判準：不到這些門檻就不下結論（比照 time-control /med 的「樣本還不夠」） */
export const MIN_SPAN_DAYS = 21;      // 體重要橫跨幾天
export const MIN_WEIGH_INS = 10;      // 至少量幾次
export const MIN_GOOD_DAYS = 14;      // 至少幾天的記錄看起來是完整的
export const GOOD_DAY_MEALS = 3;      // 一天幾筆以上才算「記得完整」

export interface WeighIn { at: Date; kg: number }
export interface DayIntake { date: string; kcal: number; recordCount: number }

export interface Calibration {
  ok: true;
  spanDays: number;
  weighIns: number;
  goodDays: number;
  firstKg: number;
  lastKg: number;
  /** 線性回歸斜率，kg／天。正數＝在增重 */
  kgPerDay: number;
  kgPerWeek: number;
  /** 體重推得的每日熱量盈餘（正＝盈餘） */
  surplusKcal: number;
  /** 記錄裡「看起來完整」那些天的平均攝取 */
  loggedKcal: number;
  /** 反推的 TDEE ＝ 記錄攝取 − 盈餘。記錄若有偏差，偏差會整包跑到這個數字上。 */
  impliedTdee: number;
  /** 使用者自己設過參考 TDEE 才有。k > 1 表示記錄比實際低（多半是漏記）。 */
  k: number | null;
}

export interface NotEnough { ok: false; reason: string; detail: string }

/**
 * 最小平方法斜率。x 用「距第一次量的天數」，避免時間戳直接進運算。
 * 回 null 表示 x 沒有變異（同一天量的都算一次）。
 */
export function slopePerDay(points: WeighIn[]): number | null {
  if (points.length < 2) return null;
  const t0 = points[0].at.getTime();
  const xs = points.map((p) => (p.at.getTime() - t0) / 86_400_000);
  const ys = points.map((p) => p.kg);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den === 0) return null;
  return num / den;
}

/**
 * @param refTdee 使用者用 /tdee 自己設的參考值。沒設就不給 k——
 *                我們不會偷偷套一個公式 TDEE 上去再說「你高估了 X%」。
 */
export function calibrate(
  weighIns: WeighIn[],
  daily: DayIntake[],
  refTdee: number | null = null,
): Calibration | NotEnough {
  const ws = [...weighIns].sort((a, b) => a.at.getTime() - b.at.getTime());

  if (ws.length < MIN_WEIGH_INS) {
    return {
      ok: false,
      reason: `樣本還不夠：體重只量了 ${ws.length} 次，要 ${MIN_WEIGH_INS} 次以上`,
      detail: "在還沒到門檻之前只報趨勢，不下結論。這是刻意的，不是壞掉。",
    };
  }

  const spanDays = (ws[ws.length - 1].at.getTime() - ws[0].at.getTime()) / 86_400_000;
  if (spanDays < MIN_SPAN_DAYS) {
    return {
      ok: false,
      reason: `樣本還不夠：體重只橫跨 ${Math.round(spanDays)} 天，要 ${MIN_SPAN_DAYS} 天以上`,
      detail: "短期體重主要是水分在動，拿來反推熱量會得到很誇張的數字。",
    };
  }

  // 🔴 只用「看起來記完整」的天算平均攝取。
  //    漏記的天會把平均往下拉，直接讓反推的 TDEE 變得莫名其妙地低。
  //    這是唯一能壓低漏記污染的手段，所以不能省。
  const good = daily.filter((d) => d.recordCount >= GOOD_DAY_MEALS);
  if (good.length < MIN_GOOD_DAYS) {
    return {
      ok: false,
      reason: `樣本還不夠：只有 ${good.length} 天的記錄看起來完整（每天 ${GOOD_DAY_MEALS} 筆以上），要 ${MIN_GOOD_DAYS} 天`,
      detail: "漏記的天會把平均攝取拉低，反推出來的 TDEE 會低到沒有意義。先把記錄補齊再看這個。",
    };
  }

  const kgPerDay = slopePerDay(ws);
  if (kgPerDay === null) {
    return { ok: false, reason: "體重資料算不出趨勢", detail: "所有紀錄都在同一天。" };
  }

  const surplusKcal = kgPerDay * KCAL_PER_KG;
  const loggedKcal = good.reduce((s, d) => s + d.kcal, 0) / good.length;
  const impliedTdee = loggedKcal - surplusKcal;

  return {
    ok: true,
    spanDays: Math.round(spanDays),
    weighIns: ws.length,
    goodDays: good.length,
    firstKg: ws[0].kg,
    lastKg: ws[ws.length - 1].kg,
    kgPerDay: Math.round(kgPerDay * 1000) / 1000,
    kgPerWeek: Math.round(kgPerDay * 7 * 100) / 100,
    surplusKcal: Math.round(surplusKcal),
    loggedKcal: Math.round(loggedKcal),
    impliedTdee: Math.round(impliedTdee),
    // k > 1：實際吃得比記錄多（漏記為主）。k < 1：記錄比實際多（高估為主）。
    k: refTdee ? Math.round(((refTdee + surplusKcal) / loggedKcal) * 100) / 100 : null,
  };
}

/**
 * 把反推的 TDEE 翻成一句人話。
 * 這裡刻意只給「範圍判讀」，不給百分比——理由見檔頭。
 */
export function readTdee(c: Calibration): string {
  const t = c.impliedTdee;
  if (t < 1400) {
    return "這個數字低到不太可能是真的 TDEE。最可能的解釋是**還有漏記**（記錄的攝取比實際少）。";
  }
  if (t > 3200) {
    return "這個數字高到不太可能是真的 TDEE。最可能的解釋是**記錄偏高估**，或這段期間體重被水分／肌肉變化干擾。";
  }
  return "這個數字落在成年人的合理範圍，表示記錄的攝取量整體上對得起來。";
}

/** 最近 n 天的體重，取每天最後一次量的 */
export function dailyWeights(ws: WeighIn[]): WeighIn[] {
  const byDay = new Map<string, WeighIn>();
  for (const w of [...ws].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    byDay.set(w.at.toISOString().slice(0, 10), w);
  }
  return [...byDay.values()];
}

// ============================================================
// 「體重 62.5」的解析
//
// ⚠️ **裸數字一律不認**。裸數字在「回覆記錄訊息」的情境已經是份量倍率
//    （見 portion.ts 的 parsePortion），在一般情境會被丟給 AI 當食物估。
//    所以一定要有「體重」兩個字或 kg／公斤 單位才算。
// ============================================================
export interface ParsedWeight { kg: number; date: string | null }

const FULLWIDTH = /[０-９．／]/g;
const toHalf = (s: string) =>
  s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * 認得：
 *   體重 62.5 / 體重62.5 / 62.5kg / 62.5 公斤 / 62.5KG
 *   9/8 體重 62.3（補登，日期寫在前面，跟 time-control 的補登同一個形狀）
 * 不認得：62.5（裸數字）
 */
export function parseWeight(raw: string, today = new Date()): ParsedWeight | null {
  let s = toHalf((raw ?? "").trim());
  if (!s) return null;

  // 日期前綴：9/8 或 2026/9/8
  let date: string | null = null;
  const dm = s.match(/^((\d{4})\/)?(\d{1,2})\/(\d{1,2})\s+/);
  if (dm) {
    const y = dm[2] ? Number(dm[2]) : today.getFullYear();
    date = `${y}-${String(Number(dm[3])).padStart(2, "0")}-${String(Number(dm[4])).padStart(2, "0")}`;
    s = s.slice(dm[0].length).trim();
  }

  const hasKeyword = /體重|weight/i.test(s);
  const hasUnit = /(kg|KG|公斤|Kg|kG)\s*$/.test(s) || /\d\s*(kg|公斤)/i.test(s);
  if (!hasKeyword && !hasUnit) return null;

  const m = s.match(/(\d{2,3}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const kg = Number(m[1]);
  // 跟資料庫的 check 約束同一組界線
  if (!Number.isFinite(kg) || kg <= 20 || kg >= 300) return null;

  return { kg: Math.round(kg * 10) / 10, date };
}
