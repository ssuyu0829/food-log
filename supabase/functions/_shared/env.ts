// 所有環境變數集中在這裡讀，缺哪一個會在啟動時就炸掉，而不是跑到一半才失敗。
function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少環境變數 ${name}（到 Supabase → Edge Functions → Secrets 設定）`);
  return v;
}
function opt(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

export const SUPABASE_URL          = need("SUPABASE_URL");
export const SUPABASE_SERVICE_KEY  = need("SUPABASE_SERVICE_ROLE_KEY");
export const TELEGRAM_BOT_TOKEN    = need("TELEGRAM_BOT_TOKEN");
export const GEMINI_API_KEY        = need("GEMINI_API_KEY");

// 可選
export const TELEGRAM_WEBHOOK_SECRET = opt("TELEGRAM_WEBHOOK_SECRET");
export const GEMINI_MODEL            = opt("GEMINI_MODEL", "gemini-2.5-flash");
export const PHOTO_BUCKET            = "meal-photos";
