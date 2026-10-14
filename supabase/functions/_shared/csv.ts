// ============================================================
// CSV 組字串。**純函式，刻意不 import db.ts**，測試不需要環境變數。
//
// 口徑：
// - 開頭帶 BOM、行尾 CRLF：Excel 直接雙擊打開繁體中文才不會變亂碼
// - null / undefined 一律空格，**不是 0**（跟報表同一個原則：沒量過 ≠ 零）
// - 以 = + - @ 開頭的字串前面補一個單引號，避免被試算表當成公式執行
//   （標題來自 AI 與使用者輸入，不能假設它乾淨）
// ============================================================

export const CSV_BOM = "﻿";

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "1" : "0";
  let s = String(v);
  if (/^[=@]/.test(s) || /^[+-](?=[\d(])/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
