import { createClient } from "jsr:@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./env.ts";

// service_role 會繞過 RLS。這支 client 只能活在 Edge Function 裡，
// 絕對不能出現在 pwa/ 底下的任何檔案。
export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cache = new Map<string, string>();

export async function getSetting(key: string, fallback = ""): Promise<string> {
  if (cache.has(key)) return cache.get(key)!;
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value ?? fallback;
  cache.set(key, v);
  return v;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.from("settings").upsert({ key, value }, { onConflict: "key" });
  cache.set(key, value);
}

/** 台北時間的「今天」是哪一天（YYYY-MM-DD） */
export function localDate(d = new Date(), tz = "Asia/Taipei"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
