// Telegram 訊息排版。原則：第一行就是結論，細節放下面。
import { esc } from "./telegram.ts";
import {
  type Completeness, completenessOf, groupByDay, hhmm, logicalDate, type MealRow,
  metTargets, TARGETS, THIN_DAY_MEALS, THIN_DAY_SPAN_HOURS, type Totals, totalsOf,
} from "./stats.ts";
import { type Calibration, type NotEnough, readTdee, type WeighIn } from "./weight.ts";

const CONF_LABEL: Record<string, string> = {
  high: "把握度高", medium: "把握度中等", low: "把握度低，份量是猜的",
};

/** 一筆記錄存好之後的回覆 */
export function mealReply(
  meal: { id: number; title: string; total_kcal: number; sugar_g: number;
          protein_g: number; fat_g: number; carb_g: number; eaten_at: string;
          confidence: string | null; estimate_note: string | null; portion_multiplier: number;
          sodium_mg?: number | null; fiber_g?: number | null; sat_fat_g?: number | null;
          added_sugar_g?: number | null; veg_servings?: number | null },
  items: { name: string; qty_desc: string; kcal: number; excluded?: boolean }[],
  today: Totals,
  target: number | null,
): string {
  const L: string[] = [];
  // 不是今天的就把日期標出來。按了「改到前一天」之後只有一閃而過的 toast，
  // 沒有這行就看不出這筆到底搬去哪天了。
  const day = logicalDate(new Date(meal.eaten_at));
  const badge = day === logicalDate()
    ? ""
    : `📅 <b>${day.slice(5).replace("-", "/")} ${hhmm(meal.eaten_at)}</b>\n`;
  const mult = meal.portion_multiplier !== 1 ? `（份量 ×${meal.portion_multiplier}）` : "";
  L.push(`${badge}<b>${esc(meal.title)}　${meal.total_kcal} kcal</b>${mult}`);

  if (items.length) {
    L.push("");
    for (const it of items.slice(0, MAX_ITEMS)) {
      const q = it.qty_desc ? ` <i>${esc(it.qty_desc)}</i>` : "";
      const line = `• ${esc(it.name)}${q} — ${Math.round(it.kcal)}`;
      // 被挑掉的用刪除線，不要直接消失——
      // 消失了就看不出「AI 有認出這項、是我自己挑掉的」
      L.push(it.excluded ? `<s>${line}</s>` : line);
    }
  }

  L.push("");
  L.push(`蛋白 ${meal.protein_g}g　脂肪 ${meal.fat_g}g　碳水 ${meal.carb_g}g　糖 ${meal.sugar_g}g`);

  // 2026-09-10 起的第二排。**沒量過的欄位整個不印**，不要印 0——
  // 印 0 會讓人以為「這餐真的沒有鈉」。舊記錄五欄全 null，所以整行不會出現。
  const ext: string[] = [];
  if (meal.sodium_mg != null)     ext.push(`鈉 ${Math.round(meal.sodium_mg)}mg`);
  if (meal.fiber_g != null)       ext.push(`纖維 ${meal.fiber_g}g`);
  if (meal.sat_fat_g != null)     ext.push(`飽脂 ${meal.sat_fat_g}g`);
  if (meal.added_sugar_g != null) ext.push(`添加糖 ${meal.added_sugar_g}g`);
  if (meal.veg_servings != null)  ext.push(`蔬菜 ${meal.veg_servings} 份`);
  if (ext.length) L.push(ext.join("　"));

  // 一餐就吃掉大半天鈉配額時當場說一句。這是唯一有「下一餐可以改」行動性的提醒。
  if (meal.sodium_mg != null && meal.sodium_mg >= TARGETS.sodium_mg * 0.6) {
    L.push(`<i>⚠️ 這一餐的鈉就佔了一天建議量（${TARGETS.sodium_mg}mg）的 ${Math.round(meal.sodium_mg / TARGETS.sodium_mg * 100)}%</i>`);
  }

  const cut = items.filter((i) => i.excluded).length;
  if (cut) {
    L.push(items.length === cut
      ? `<i>※ 每一項都被挑掉了，這筆現在是 0 kcal。整筆都不是你吃的就按下面的 🗑 比較乾淨</i>`
      : `<i>※ 已挑掉 ${cut} 項（不計入熱量）</i>`);
  }

  const bits: string[] = [];
  if (meal.confidence) bits.push(CONF_LABEL[meal.confidence] ?? meal.confidence);
  if (meal.estimate_note) bits.push(meal.estimate_note);
  if (bits.length) L.push(`<i>※ ${esc(bits.join("；"))}</i>`);

  L.push("");
  // 這筆搬到別天之後，累計看的就是那一天，標題也要跟著改，否則會誤讀成今天的量
  const label = badge ? `${day.slice(5).replace("-", "/")} 累計` : "今日累計";
  L.push(`${label} <b>${today.kcal}</b> kcal` + (target ? `／目標 ${target}（剩 ${target - today.kcal}）` : "") +
    `　糖 ${today.sugar_g}g　手搖 ${today.drinkCount} 杯`);

  // 這行是「自訂份量」唯一的發現路徑。沒有它等於沒有這個功能。
  L.push(`<i>回覆這則訊息打一個數字＝自訂份量（例如 <code>0.7</code>、<code>2/3</code>）</i>`);
  return L.join("\n");
}

/** 訊息裡最多列幾項。按鈕清單用同一個上限，兩邊才對得起來。 */
export const MAX_ITEMS = 12;

export function correctionButtons(mealId: number, itemCount = 0) {
  const rows = [
    [
      { text: "×0.5", callback_data: `m:${mealId}:0.5` },
      { text: "×1.5", callback_data: `m:${mealId}:1.5` },
      { text: "×2",   callback_data: `m:${mealId}:2` },
      { text: "還原", callback_data: `m:${mealId}:1` },
    ],
    // 補登：兩顆而不是一顆「改到昨天」。按兩下就退兩天，按過頭也推得回來，
    // 而且完全不需要記狀態——每次都只是在現有時間上加減一天。
    [
      { text: "◀ 改到前一天", callback_data: `day:${mealId}:-1` },
      { text: "改到後一天 ▶", callback_data: `day:${mealId}:1` },
    ],
  ];
  // 只有一項的（手搖）挑掉等於整筆刪掉，不用多這顆
  if (itemCount > 1) {
    rows.push([{ text: "✂️ 挑掉某一項", callback_data: `items:${mealId}` }]);
  }
  rows.push([{ text: "🗑 刪掉這筆", callback_data: `del:${mealId}` }]);
  return rows;
}

/**
 * 按下「✂️ 挑掉某一項」之後，同一則訊息的鍵盤換成細項清單。
 * 按一下劃掉、再按一下加回來，狀態全部在資料庫裡，bot 不用記任何東西。
 */
export function itemButtons(
  mealId: number,
  items: { id: number; name: string; kcal: number | null; excluded: boolean }[],
) {
  const rows = items.slice(0, MAX_ITEMS).map((it) => {
    const name = it.name.length > 16 ? `${it.name.slice(0, 16)}…` : it.name;
    const mark = it.excluded ? "⬜" : "✅";
    return [{
      text: `${mark} ${name} ${Math.round(Number(it.kcal ?? 0))}`,
      callback_data: `it:${mealId}:${it.id}`,
    }];
  });
  rows.push([{ text: "⬅ 完成", callback_data: `done:${mealId}` }]);
  return rows;
}

/** /today 與每晚推播 */
export function daySummary(
  rows: MealRow[], target: number | null, heading: string, proteinTarget: number | null = null,
): string {
  const t = totalsOf(rows);
  const L: string[] = [];

  if (rows.length === 0) {
    return `${heading}\n\n今天還沒有任何記錄。`;
  }

  const headline = target
    ? (t.kcal <= target
        ? `${heading}　<b>${t.kcal} kcal</b>，還在目標內（剩 ${target - t.kcal}）`
        : `${heading}　<b>${t.kcal} kcal</b>，超過目標 ${t.kcal - target}`)
    : `${heading}　<b>${t.kcal} kcal</b>`;
  L.push(headline);
  L.push("");

  for (const r of rows) {
    const icon = r.is_drink ? "🥤" : "🍽";
    L.push(`${hhmm(r.eaten_at)} ${icon} ${esc(r.title ?? "未命名")} — ${Math.round(Number(r.total_kcal ?? 0))}`);
  }

  L.push("");
  L.push(`糖 ${t.sugar_g}g　蛋白 ${Math.round(t.protein_g)}g　脂肪 ${Math.round(t.fat_g)}g　碳水 ${Math.round(t.carb_g)}g`);
  L.push(...targetLines(t, proteinTarget));
  if (t.drinkCount > 0) {
    L.push(`手搖 <b>${t.drinkCount} 杯</b>，佔今天 ${Math.round(t.drinkKcal / Math.max(t.kcal, 1) * 100)}% 的熱量`);
  }
  return L.join("\n");
}

/**
 * 一天的四個健康指標。**沒量過的整項不印**（見 stats.ts 的 metTargets）。
 * 用「✅／⚠️ + 實際值 / 門檻」而不是只給數字——分心時掃一眼就知道要不要動。
 */
function targetLines(t: Totals, proteinTarget: number | null = null): string[] {
  const out: string[] = [];
  const row = (icon: string, label: string, v: number | null, target: number, unit: string, over: boolean) => {
    if (v === null) return;
    const bad = over ? v > target : v < target;
    out.push(`${bad ? "⚠️" : "✅"} ${label} ${v}${unit}${over ? " / 上限 " : " / 目標 "}${target}${unit}`);
    void icon;
  };
  // 蛋白質排第一：它是唯一「要吃夠」而且跟體重掛鉤的。沒體重就整行不印。
  if (proteinTarget !== null) row("", "蛋白質", Math.round(t.protein_g), proteinTarget, "g", false);
  row("", "鈉", t.sodium_mg, TARGETS.sodium_mg, "mg", true);
  row("", "添加糖", t.added_sugar_g, TARGETS.added_sugar_g, "g", true);
  row("", "飽和脂肪", t.sat_fat_g, TARGETS.sat_fat_g, "g", true);
  row("", "膳食纖維", t.fiber_g, TARGETS.fiber_g, "g", false);
  row("", "蔬菜", t.veg_servings, TARGETS.veg_servings, " 份", false);

  if (out.length && t.sugar_g > 0 && t.added_sugar_g !== null) {
    // 這一行是在修 2026-09-10 之前最誤導人的口徑：
    // 舊報表的「糖」是總糖（含鮮奶的乳糖與水果的果糖），WHO 的 50g 門檻講的是游離糖。
    const 天然 = Math.round((t.sugar_g - t.added_sugar_g) * 10) / 10;
    if (天然 > 0) out.push(`<i>※ 總糖 ${t.sugar_g}g 裡有 ${天然}g 是乳糖／果糖，不算進上面的添加糖</i>`);
  }
  return out;
}

/**
 * /week 與每週報告
 *
 * ⚠️ 2026-09-10 起，**第一行是記錄完整度，不是平均熱量**。
 * 起因：9/7 只有 3 筆、9/8 只有 2 筆（兩筆都在 00:02–00:03），
 * 但這兩天的「平均熱量」卻是全週最高——那不是吃比較多，是只記了大餐。
 * 平均值放第一行會讓人直接讀錯，所以先講這週的數字能不能信。
 */
export function weekReport(
  rows: MealRow[], days: string[], prev?: MealRow[], proteinTarget: number | null = null,
): string {
  const t = totalsOf(rows);
  const byDay = groupByDay(rows);
  const c = completenessOf(rows, days);
  // ⚠️ 平均只能用「已經過完」那些天的熱量除以那些天數。
  //    今天已經被排除在 loggedDays 之外（還沒過完不判斷），
  //    但 t.kcal 仍含今天的餐——直接相除會把平均灌高。
  const judged = c.shapes.filter((x) => !x.inProgress);
  const judgedKcal = judged.reduce((sum, x) => sum + x.kcal, 0);
  const avg = judged.length ? Math.round(judgedKcal / judged.length) : 0;

  const L: string[] = [];

  // --- 第一行：這週的數字能不能信 ---
  L.push(completenessHeadline(c));
  L.push("");
  L.push(`平均每天 <b>${avg}</b> kcal（只算有記、且已經過完的 ${judged.length} 天）　手搖 ${t.drinkCount} 杯`);
  L.push("");

  // 每日長條
  const max = Math.max(1, ...days.map((d) => totalsOf(byDay.get(d) ?? []).kcal));
  const wd = ["日", "一", "二", "三", "四", "五", "六"];
  const thin = new Set(c.thinDays.map((d) => d.date));
  for (const d of days) {
    const dt = totalsOf(byDay.get(d) ?? []);
    const bars = "█".repeat(Math.round(dt.kcal / max * 12));
    const drinks = dt.drinkCount ? ` 🥤${dt.drinkCount}` : "";
    const label = `${d.slice(5)}(${wd[new Date(`${d}T12:00:00+08:00`).getDay()]})`;
    // 疑似漏記的那幾天標出來，否則長條圖會被當成「那天真的吃這麼少／這麼多」
    const flag = thin.has(d) ? " ⚠️" : "";
    L.push(`${label} ${String(dt.kcal).padStart(4)} ${bars}${drinks}${flag}`);
  }

  // --- 健康指標：講「幾天達標」而不是總量 ---
  const targetSummary = weekTargets(days, byDay, proteinTarget);
  if (targetSummary.length) {
    L.push("");
    L.push(...targetSummary);
  }

  L.push("");
  L.push(`總糖量 ${t.sugar_g}g（約 ${(t.sugar_g / 4).toFixed(0)} 顆方糖）` +
    (t.added_sugar_g !== null ? `，其中添加糖 ${t.added_sugar_g}g` : ""));

  // --- 進食時間窗：不需要任何額外輸入，資料庫本來就有 ---
  if (c.shapes.length) {
    const firsts = c.shapes.map((x) => x.first!).sort();
    const lasts = c.shapes.map((x) => x.last!).sort();
    L.push(`進食時間窗：最早 ${firsts[0]}、最晚 ${lasts[lasts.length - 1]}` +
      (c.lateNightCount ? `　宵夜（22:00 後）${c.lateNightCount} 筆` : ""));
  }

  if (prev && prev.length) {
    const p = totalsOf(prev);
    const pDays = groupByDay(prev).size || 1;
    const pAvg = Math.round(p.kcal / pDays);
    const dK = avg - pAvg, dD = t.drinkCount - p.drinkCount;
    L.push(`比上週：熱量 ${sign(dK)} kcal/天，手搖 ${sign(dD)} 杯`);
  }

  // 本週最貴的一餐
  const top = [...rows].sort((a, b) => Number(b.total_kcal ?? 0) - Number(a.total_kcal ?? 0))[0];
  if (top) L.push(`最高的一筆：${esc(top.title ?? "")} ${Math.round(Number(top.total_kcal))} kcal`);

  // --- 漏記的細節放最後，但一定要有 ---
  if (c.thinDays.length || c.emptyDays.length) {
    L.push("");
    if (c.emptyDays.length) {
      L.push(`<i>完全沒記：${c.emptyDays.map((d) => d.slice(5)).join("、")}</i>`);
    }
    for (const d of c.thinDays) {
      const why = d.count <= THIN_DAY_MEALS
        ? `只有 ${d.count} 筆`
        : `全部集中在 ${d.spanHours} 小時內（${d.first}–${d.last}）`;
      L.push(`<i>⚠️ ${d.date.slice(5)} 疑似漏記：${why}，這天的 ${d.kcal} kcal 大概偏低</i>`);
    }
  }
  return L.join("\n");
}

function completenessHeadline(c: Completeness): string {
  if (c.loggedDays === 0) return "<b>本週回顧</b>　這 7 天完全沒有記錄。";
  const suspect = c.thinDays.length + c.emptyDays.length;
  if (suspect === 0) {
    return `<b>本週回顧</b>　${c.totalDays} 天都記得完整，下面的數字可以直接看。`;
  }
  return `<b>本週回顧</b>　${c.totalDays} 天裡有 <b>${suspect} 天疑似漏記</b>` +
    `（沒記 ${c.emptyDays.length} 天、記得太少 ${c.thinDays.length} 天）。` +
    `\n<i>判準：一天 ≤${THIN_DAY_MEALS} 筆，或全部集中在 ${THIN_DAY_SPAN_HOURS} 小時內。` +
    `下面所有平均值都建立在剩下那些天上。</i>`;
}

/**
 * 一週的達標天數。
 * ⚠️ 分母是「有量到這一項的天數」，不是 7——
 * 2026-09-10 之前的記錄這幾欄全是 null，混進去會算出假的達標率。
 */
function weekTargets(
  days: string[], byDay: Map<string, MealRow[]>, proteinTarget: number | null = null,
): string[] {
  const labels: Record<string, string> = {
    protein_g: "蛋白質達標", sodium_mg: "鈉不超標", added_sugar_g: "添加糖不超標", sat_fat_g: "飽和脂肪不超標",
    fiber_g: "纖維達標", veg_servings: "蔬菜 3 份",
  };
  const hit: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const d of days) {
    const rs = byDay.get(d);
    if (!rs?.length) continue;
    const m = metTargets(totalsOf(rs), proteinTarget);
    for (const [k, v] of Object.entries(m)) {
      if (v === null) continue;
      seen[k] = (seen[k] ?? 0) + 1;
      if (v) hit[k] = (hit[k] ?? 0) + 1;
    }
  }
  const keys = Object.keys(seen);
  if (!keys.length) return [];
  const out = ["<b>健康指標</b>（分母只算有量到的天）"];
  for (const k of Object.keys(labels)) {
    if (!seen[k]) continue;
    const n = hit[k] ?? 0;
    out.push(`${n === seen[k] ? "✅" : n === 0 ? "❌" : "⚠️"} ${labels[k]}　${n}/${seen[k]} 天`);
  }
  return out;
}

// ============================================================
// 2026-09-10：體重與校準
// ============================================================

/** /weight */
export function weightReport(ws: WeighIn[]): string {
  if (!ws.length) {
    return ["還沒有任何體重記錄。",
      "",
      "打 <code>體重 62.5</code> 就記一筆（也認得 <code>62.5kg</code>、<code>62.5 公斤</code>）。",
      "補登：<code>9/8 體重 62.3</code>。",
      "",
      "<i>為什麼要記：體重是唯一能從外部驗證熱量估計準不準的東西。</i>",
    ].join("\n");
  }
  const sorted = [...ws].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = sorted[0], last = sorted[sorted.length - 1];
  const spanDays = Math.max(1, Math.round((last.at.getTime() - first.at.getTime()) / 86_400_000));
  const d = Math.round((last.kg - first.kg) * 10) / 10;

  const L = [`<b>體重</b>　最新 ${last.kg} kg（${hhmm(last.at.toISOString())}）`, ""];
  L.push(`${spanDays} 天內 ${d > 0 ? "+" : ""}${d} kg（${first.kg} → ${last.kg}），共 ${sorted.length} 筆`);
  L.push("");
  for (const w of sorted.slice(-10)) {
    L.push(`${w.at.toISOString().slice(5, 10).replace("-", "/")}　${w.kg} kg`);
  }
  L.push("");
  L.push("<i>/calib 看由體重反推的熱量校準</i>");
  return L.join("\n");
}

/**
 * /calib
 *
 * 🔴 這則訊息的措辭是刻意的。體重只定得出「真實攝取 − TDEE」，
 *    分不開「AI 高估」與「漏記」（兩者方向相反，會互相抵銷）。
 *    所以這裡只講「反推的 TDEE」與範圍判讀，**不給「高估了 X%」這種數字**。
 *    限制要寫在訊息裡，不是只寫在註解裡——註解使用者看不到。
 */
export function calibReport(c: Calibration | NotEnough, refTdee: number | null): string {
  if (!c.ok) {
    return [`<b>熱量校準</b>　${c.reason}`, "", `<i>${c.detail}</i>`,
      "", "<i>看到「樣本還不夠」不是壞掉，是刻意的。</i>"].join("\n");
  }
  const L: string[] = [];
  L.push(`<b>熱量校準</b>　由體重反推，你的 TDEE 約 <b>${c.impliedTdee}</b> kcal/天`);
  L.push("");
  L.push(`體重 ${c.firstKg} → ${c.lastKg} kg（${c.spanDays} 天、量了 ${c.weighIns} 次）`);
  L.push(`趨勢 ${c.kgPerWeek > 0 ? "+" : ""}${c.kgPerWeek} kg/週 ⇒ 每天淨${c.surplusKcal >= 0 ? "盈餘" : "赤字"} ${Math.abs(c.surplusKcal)} kcal`);
  L.push(`記錄的平均攝取 ${c.loggedKcal} kcal/天（只算 ${c.goodDays} 天記得完整的）`);
  L.push("");
  L.push(readTdee(c));
  if (c.k !== null && refTdee) {
    L.push("");
    L.push(`對照你設的參考 TDEE ${refTdee}：k = <b>${c.k}</b>`);
    L.push(c.k > 1.05
      ? "<i>k > 1＝實際吃得比記錄多，最可能是還有漏記。</i>"
      : c.k < 0.95
      ? "<i>k < 1＝記錄比實際多，最可能是估得偏高。</i>"
      : "<i>k ≈ 1，記錄跟實際對得上。</i>");
  }
  L.push("");
  L.push("<i>⚠️ 這個數字同時混了三件事：AI 估得準不準、有沒有漏記、你的 TDEE 跟公式差多少。");
  L.push("體重資料<b>分不開</b>這三者（漏記讓它往上、高估讓它往下，會互相抵銷），");
  L.push("所以只能當方向判讀，不要拿它宣稱「AI 高估了幾 %」。</i>");
  return L.join("\n");
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
