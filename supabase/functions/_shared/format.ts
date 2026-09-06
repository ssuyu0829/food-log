// Telegram 訊息排版。原則：第一行就是結論，細節放下面。
import { esc } from "./telegram.ts";
import { type MealRow, type Totals, groupByDay, hhmm, logicalDate, totalsOf } from "./stats.ts";

const CONF_LABEL: Record<string, string> = {
  high: "把握度高", medium: "把握度中等", low: "把握度低，份量是猜的",
};

/** 一筆記錄存好之後的回覆 */
export function mealReply(
  meal: { id: number; title: string; total_kcal: number; sugar_g: number;
          protein_g: number; fat_g: number; carb_g: number; eaten_at: string;
          confidence: string | null; estimate_note: string | null; portion_multiplier: number },
  items: { name: string; qty_desc: string; kcal: number }[],
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
    for (const it of items.slice(0, 12)) {
      const q = it.qty_desc ? ` <i>${esc(it.qty_desc)}</i>` : "";
      L.push(`• ${esc(it.name)}${q} — ${Math.round(it.kcal)}`);
    }
  }

  L.push("");
  L.push(`蛋白 ${meal.protein_g}g　脂肪 ${meal.fat_g}g　碳水 ${meal.carb_g}g　糖 ${meal.sugar_g}g`);

  const bits: string[] = [];
  if (meal.confidence) bits.push(CONF_LABEL[meal.confidence] ?? meal.confidence);
  if (meal.estimate_note) bits.push(meal.estimate_note);
  if (bits.length) L.push(`<i>※ ${esc(bits.join("；"))}</i>`);

  L.push("");
  // 這筆搬到別天之後，累計看的就是那一天，標題也要跟著改，否則會誤讀成今天的量
  const label = badge ? `${day.slice(5).replace("-", "/")} 累計` : "今日累計";
  L.push(`${label} <b>${today.kcal}</b> kcal` + (target ? `／目標 ${target}（剩 ${target - today.kcal}）` : "") +
    `　糖 ${today.sugar_g}g　手搖 ${today.drinkCount} 杯`);
  return L.join("\n");
}

export function correctionButtons(mealId: number) {
  return [
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
    [{ text: "🗑 刪掉這筆", callback_data: `del:${mealId}` }],
  ];
}

/** /today 與每晚推播 */
export function daySummary(rows: MealRow[], target: number | null, heading: string): string {
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
  if (t.drinkCount > 0) {
    L.push(`手搖 <b>${t.drinkCount} 杯</b>，佔今天 ${Math.round(t.drinkKcal / Math.max(t.kcal, 1) * 100)}% 的熱量`);
  }
  return L.join("\n");
}

/** /week 與每週報告 */
export function weekReport(rows: MealRow[], days: string[], prev?: MealRow[]): string {
  const t = totalsOf(rows);
  const byDay = groupByDay(rows);
  const loggedDays = byDay.size;
  const avg = loggedDays ? Math.round(t.kcal / loggedDays) : 0;

  const L: string[] = [];
  L.push(`<b>本週回顧</b>　平均每天 ${avg} kcal，手搖 ${t.drinkCount} 杯`);
  L.push("");

  // 每日長條
  const max = Math.max(1, ...days.map((d) => totalsOf(byDay.get(d) ?? []).kcal));
  const wd = ["日", "一", "二", "三", "四", "五", "六"];
  for (const d of days) {
    const dt = totalsOf(byDay.get(d) ?? []);
    const bars = "█".repeat(Math.round(dt.kcal / max * 12));
    const drinks = dt.drinkCount ? ` 🥤${dt.drinkCount}` : "";
    const label = `${d.slice(5)}(${wd[new Date(`${d}T12:00:00+08:00`).getDay()]})`;
    L.push(`${label} ${String(dt.kcal).padStart(4)} ${bars}${drinks}`);
  }

  L.push("");
  L.push(`總糖量 ${t.sugar_g}g（約 ${(t.sugar_g / 4).toFixed(0)} 顆方糖）`);

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

  if (loggedDays < days.length) {
    L.push(`<i>※ ${days.length} 天裡有 ${days.length - loggedDays} 天完全沒記錄，平均值只算有記的天數</i>`);
  }
  return L.join("\n");
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
