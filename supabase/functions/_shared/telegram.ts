import { TELEGRAM_BOT_TOKEN } from "./env.ts";

const API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function call(method: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) console.error(`telegram ${method} 失敗:`, JSON.stringify(json));
  return json.result;
}

export type Button = { text: string; callback_data: string };

export function sendMessage(chat_id: number, text: string, buttons?: Button[][]) {
  return call("sendMessage", {
    chat_id, text, parse_mode: "HTML", disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export function editMessage(chat_id: number, message_id: number, text: string, buttons?: Button[][]) {
  return call("editMessageText", {
    chat_id, message_id, text, parse_mode: "HTML", disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export function answerCallback(id: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

export function sendChatAction(chat_id: number, action = "typing") {
  return call("sendChatAction", { chat_id, action });
}

/** 下載 Telegram 上的檔案，回傳 bytes 與 mime */
export async function downloadFile(file_id: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const f = await call("getFile", { file_id });
  if (!f?.file_path) throw new Error("拿不到 Telegram file_path");
  const res = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = f.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { bytes, mime };
}

/** 傳一個檔案（/export 用）。sendDocument 要走 multipart，不能像其他方法一樣丟 JSON。 */
export async function sendDocument(
  chat_id: number, filename: string, content: string | Uint8Array, caption?: string,
  mime = "text/csv",
) {
  const fd = new FormData();
  fd.append("chat_id", String(chat_id));
  fd.append("document", new Blob([content as BlobPart], { type: mime }), filename);
  if (caption) { fd.append("caption", caption); fd.append("parse_mode", "HTML"); }
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: fd });
  const json = await res.json();
  if (!json.ok) console.error("telegram sendDocument 失敗:", JSON.stringify(json));
  return json.result;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
