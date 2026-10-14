// ============================================================
// /again「再來一份」的純函式。**刻意不 import db.ts**，測試不需要環境變數。
//
// 為什麼要有這個功能：無糖鮮奶茶、固定那家便當這種重複餐佔記錄的大半，
// 每次重拍或重打是漏記的主因，而漏記正是 /calib 最大的汙染源。
// 複製一筆比重新辨識便宜得多，而且數字跟上次完全一樣，趨勢圖不會多一個雜訊。
// ============================================================

export interface RecentMeal {
  id: number;
  title: string | null;
  total_kcal: number | null;
}

/** 預設列幾個。Telegram 一排一顆按鈕，超過 8 顆要滑，反而慢。 */
export const AGAIN_LIMIT = 8;

/** 標題正規化：去頭尾空白、連續空白縮成一個、全部小寫。「鮮奶茶 」和「鮮奶茶」是同一樣東西。 */
export const normalizeTitle = (t: string | null | undefined): string =>
  String(t ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * 從「最新在前」的記錄裡挑出不重複的標題。
 * - 空標題跳過（沒東西可以按）
 * - keyword 有給就只留標題含關鍵字的（不分大小寫）
 * - 保序：最近吃過的排前面
 */
export function recentDistinct<T extends RecentMeal>(rows: T[], n = AGAIN_LIMIT, keyword = ""): T[] {
  const kw = normalizeTitle(keyword);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = normalizeTitle(r.title);
    if (!key) continue;
    if (kw && !key.includes(kw)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}
