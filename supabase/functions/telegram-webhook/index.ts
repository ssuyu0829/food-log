// ============================================================
// Telegram Bot 主入口
// 部署：supabase functions deploy telegram-webhook --no-verify-jwt
// ============================================================
import { PHOTO_BUCKET, TELEGRAM_WEBHOOK_SECRET } from "../_shared/env.ts";
import { db, getSetting, setSetting } from "../_shared/db.ts";
import {
  answerCallback, downloadFile, editMessage, esc, sendChatAction, sendMessage,
} from "../_shared/telegram.ts";
import { analyzeFood, type FoodAnalysis } from "../_shared/gemini.ts";
import { lookupDrink, parseDrink } from "../_shared/drinks.ts";
import { correctionButtons, daySummary, mealReply, weekReport } from "../_shared/format.ts";
import { dayBounds, lastNDays, mealsBetween, totalsOf } from "../_shared/stats.ts";
import { localDate } from "../_shared/db.ts";

const TZ = "Asia/Taipei";

Deno.serve(async (req) => {
  // 1. 驗證這真的是 Telegram 打來的
  if (TELEGRAM_WEBHOOK_SECRET &&
      req.headers.get("x-telegram-bot-api-secret-token") !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let update: any;
  try { update = await req.json(); } catch { return ok(); }

  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e) {
    console.error("處理 update 失敗:", e);
    const chat = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    if (chat) await sendMessage(chat, `😵 出錯了：${esc(String(e).slice(0, 300))}`);
  }
  return ok(); // 一律回 200，否則 Telegram 會不斷重送同一則
});

const ok = () => new Response("ok");

// ------------------------------------------------------------
// 授權：只服務綁定的那一個 chat
// ------------------------------------------------------------
async function authorize(chatId: number, text: string): Promise<boolean> {
  const bound = await getSetting("tg_chat_id");
  if (!bound) {
    if (text.startsWith("/start")) {
      await setSetting("tg_chat_id", String(chatId));
      await sendMessage(chatId, [
        "✅ 綁定完成，這個 Bot 現在只聽你的。",
        "",
        "<b>怎麼用</b>",
        "• 直接傳一張食物照片 → 我辨識並記下來",
        "• 照片可以加說明（例如「兩人份」），我會優先採信",
        "• 打字也可以：<code>滷肉飯 一碗</code>",
        "• 手搖照這樣打：<code>50嵐 四季春 微糖 大</code>",
        "  沒講甜度＝<b>無糖</b>，沒講杯型＝中杯。所以只打 <code>鮮奶茶</code> 就是無糖中杯。",
        "",
        "<b>指令</b>",
        "/today 今天吃了什麼　/week 本週回顧",
        "/target 1800 設每日熱量目標（/target 0 取消）",
        "/undo 刪掉最後一筆　/help 說明",
      ].join("\n"));
      return false;
    }
    await sendMessage(chatId, "這個 Bot 還沒綁定。請傳 /start 綁定成你的專屬帳號。");
    return false;
  }
  if (String(chatId) !== bound) return false; // 陌生人，直接無視
  return true;
}

// ------------------------------------------------------------
// 訊息
// ------------------------------------------------------------
async function onMessage(msg: any) {
  const chatId: number = msg.chat.id;
  const text: string = (msg.text ?? msg.caption ?? "").trim();

  if (!await authorize(chatId, text)) return;

  const photo = pickPhoto(msg);
  if (photo) return await handlePhoto(chatId, msg, photo, text);
  if (!text) return;
  if (text.startsWith("/")) return await handleCommand(chatId, text);
  return await handleText(chatId, msg, text);
}

/** 取最大張的照片；也接受用「檔案」方式傳來的圖 */
function pickPhoto(msg: any): { file_id: string } | null {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    return msg.photo[msg.photo.length - 1];
  }
  if (msg.document?.mime_type?.startsWith("image/")) return { file_id: msg.document.file_id };
  return null;
}

// ------------------------------------------------------------
// 指令
// ------------------------------------------------------------
async function handleCommand(chatId: number, text: string) {
  const [cmd, ...args] = text.split(/\s+/);
  const base = cmd.split("@")[0].toLowerCase();

  switch (base) {
    case "/start":
    case "/help":
      return await sendMessage(chatId, [
        "<b>怎麼用</b>",
        "• 傳一張食物照片（可加說明，例如「兩人份」）",
        "• 打字：<code>滷肉飯 一碗</code>",
        "• 手搖：<code>50嵐 四季春 微糖 大</code>",
        "  沒講甜度＝<b>無糖</b>，沒講杯型＝中杯（<code>鮮奶茶</code> = 無糖中杯）",
        "",
        "<b>指令</b>",
        "/today 今天　/week 本週",
        "/target 1800 設每日目標（/target 0 取消）",
        "/limit 3 設每週手搖上限（只出現在統計裡，不會當場念你）",
        "/undo 刪掉最後一筆　/app 拿報表網址",
      ].join("\n"));

    case "/today": {
      const [s, e] = dayBounds(localDate(new Date(), TZ));
      const rows = await mealsBetween(s, e);
      const target = Number(await getSetting("daily_kcal_target")) || null;
      return await sendMessage(chatId, daySummary(rows, target, "<b>今天</b>"));
    }

    case "/week": {
      const [s, e, days] = lastNDays(7);
      const rows = await mealsBetween(s, e);
      const prevStart = new Date(new Date(s).getTime() - 7 * 86400000).toISOString();
      const prev = await mealsBetween(prevStart, s);
      return await sendMessage(chatId, weekReport(rows, days, prev));
    }

    case "/target": {
      const v = args[0] ?? "";
      if (!/^\d+$/.test(v)) return await sendMessage(chatId, "用法：<code>/target 1800</code>（傳 0 取消目標）");
      await setSetting("daily_kcal_target", v === "0" ? "" : v);
      return await sendMessage(chatId, v === "0" ? "已取消每日目標，之後只報數字不做評價。" : `每日目標設成 ${v} kcal。`);
    }

    case "/limit": {
      const v = args[0] ?? "";
      if (!/^\d+$/.test(v)) return await sendMessage(chatId, "用法：<code>/limit 3</code>（每週手搖杯數上限，傳 0 取消）");
      await setSetting("weekly_drink_limit", v === "0" ? "" : v);
      return await sendMessage(chatId, v === "0" ? "已取消手搖上限。" : `每週手搖上限設成 ${v} 杯，會出現在每日／每週回顧裡。`);
    }

    case "/undo": {
      const { data } = await db.from("meals").select("id,title")
        .is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
      if (!data?.length) return await sendMessage(chatId, "沒有可以刪的記錄。");
      await db.from("meals").update({ deleted_at: new Date().toISOString() }).eq("id", data[0].id);
      return await sendMessage(chatId, `已刪掉「${esc(data[0].title ?? "")}」。`);
    }

    case "/app": {
      const url = await getSetting("pwa_url");
      return await sendMessage(chatId, url
        ? `報表：${url}\n（用 Safari 開 → 分享 → 加入主畫面）`
        : "PWA 還沒設定網址。等前端上線後，把網址填進 settings 表的 pwa_url。");
    }

    default:
      return await sendMessage(chatId, "不認識這個指令，試試 /help");
  }
}

// ------------------------------------------------------------
// 照片
// ------------------------------------------------------------
async function handlePhoto(chatId: number, msg: any, photo: { file_id: string }, caption: string) {
  await sendChatAction(chatId);
  const { bytes, mime } = await downloadFile(photo.file_id);

  const analysis = await analyzeFood({ image: { bytes, mime }, text: caption || undefined });
  if (!analysis.is_food) {
    return await sendMessage(chatId, "這張照片裡我看不到食物或飲料。要不要直接打字告訴我吃了什麼？");
  }

  // 照片存進 private bucket，PWA 之後用 signed URL 顯示
  const day = localDate(new Date(), TZ);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${day}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) console.error("照片上傳失敗（記錄仍會存）:", upErr);

  await saveAndReply(chatId, msg, analysis, {
    source: "photo", photo_path: upErr ? null : path, raw_text: caption || null,
  });
}

// ------------------------------------------------------------
// 文字：先當手搖查表，查不到再交給 AI
// ------------------------------------------------------------
async function handleText(chatId: number, msg: any, text: string) {
  await sendChatAction(chatId);

  const parsed = parseDrink(text);
  if (parsed.looksLikeDrink) {
    const hit = await lookupDrink(parsed);
    if (hit) {
      const analysis: FoodAnalysis = {
        is_food: true, title: hit.title,
        items: [{ name: hit.title, qty_desc: parsed.size === "L" ? "大杯" : "中杯",
                  kcal: hit.kcal, protein_g: 0, fat_g: 0, carb_g: hit.sugar_g, sugar_g: hit.sugar_g }],
        total_kcal: hit.kcal, protein_g: 0, fat_g: 0, carb_g: Math.round(hit.sugar_g), sugar_g: hit.sugar_g,
        confidence: hit.sourceType === "official" || hit.sourceType === "searched" ? "high" : "medium",
        note: sourceNote(hit.sourceType, hit.note, hit.sourceUrl),
        model: hit.sourceType === "searched" ? "gemini+search" : "drinks-table",
      };
      return await saveAndReply(chatId, msg, analysis, {
        source: "drink", raw_text: text, is_drink: true, drink_id: hit.row?.id ?? null,
      });
    }
  }

  // 不是手搖，或表裡真的查不到 → 交給 AI 用文字估
  const analysis = await analyzeFood({ text });
  if (!analysis.is_food) {
    return await sendMessage(chatId, "這段文字我看不出是在講食物。試試「排骨便當」或「50嵐 四季春 微糖 大」。");
  }
  await saveAndReply(chatId, msg, analysis, {
    source: "text", raw_text: text, is_drink: parsed.looksLikeDrink,
  });
}

function sourceNote(t: string, note: string, url: string | null): string {
  const head = t === "official" ? "官方熱量表"
    : t === "searched" ? "剛上網查到的官方資料"
    : "推估值（非官方數字，誤差約 ±25%）";
  return [head, note, url ? `來源：${url}` : ""].filter(Boolean).join("；");
}

// ------------------------------------------------------------
// 存檔 + 回覆
// ------------------------------------------------------------
async function saveAndReply(
  chatId: number, msg: any, a: FoodAnalysis,
  extra: Record<string, unknown>,
) {
  const { data: meal, error } = await db.from("meals").insert({
    source: "text", title: a.title,
    total_kcal: a.total_kcal, protein_g: a.protein_g, fat_g: a.fat_g,
    carb_g: a.carb_g, sugar_g: a.sugar_g,
    confidence: a.confidence, estimate_note: a.note || null, model: a.model,
    tg_chat_id: chatId, tg_message_id: msg.message_id,
    ...extra,
  }).select().single();
  if (error) throw error;

  if (a.items.length) {
    await db.from("meal_items").insert(a.items.map((it, i) => ({
      meal_id: meal.id, name: it.name, qty_desc: it.qty_desc,
      kcal: it.kcal, protein_g: it.protein_g, fat_g: it.fat_g,
      carb_g: it.carb_g, sugar_g: it.sugar_g, ord: i,
    })));
  }

  const [s, e] = dayBounds(localDate(new Date(), TZ));
  const today = totalsOf(await mealsBetween(s, e));
  const target = Number(await getSetting("daily_kcal_target")) || null;

  await sendMessage(chatId,
    mealReply({ ...meal, portion_multiplier: 1 }, a.items, today, target),
    correctionButtons(meal.id));
}

// ------------------------------------------------------------
// 修正按鈕
// ------------------------------------------------------------
async function onCallback(cq: any) {
  const chatId: number = cq.message.chat.id;
  if (!await authorize(chatId, "")) return await answerCallback(cq.id);

  const [kind, idStr, multStr] = String(cq.data ?? "").split(":");
  const mealId = Number(idStr);
  if (!mealId) return await answerCallback(cq.id);

  if (kind === "del") {
    await db.from("meals").update({ deleted_at: new Date().toISOString() }).eq("id", mealId);
    await editMessage(chatId, cq.message.message_id, "🗑 已刪掉這筆。");
    return await answerCallback(cq.id, "刪掉了");
  }

  if (kind !== "m") return await answerCallback(cq.id);

  const mult = Number(multStr);
  if (!Number.isFinite(mult) || mult <= 0) return await answerCallback(cq.id);

  // 從 meal_items 的原始值重算，所以連按 ×2 再按 ×0.5 也會回到正確數字
  const { data: items } = await db.from("meal_items").select("*").eq("meal_id", mealId).order("ord");
  const list = items ?? [];
  const sum = (k: string) => list.reduce((s: number, i: any) => s + Number(i[k] ?? 0), 0);

  const { data: meal } = await db.from("meals")
    .update({
      portion_multiplier: mult,
      total_kcal: Math.round(sum("kcal") * mult),
      protein_g: Math.round(sum("protein_g") * mult),
      fat_g: Math.round(sum("fat_g") * mult),
      carb_g: Math.round(sum("carb_g") * mult),
      sugar_g: Math.round(sum("sugar_g") * mult * 10) / 10,
    })
    .eq("id", mealId).select().single();
  if (!meal) return await answerCallback(cq.id, "找不到這筆");

  const [s, e] = dayBounds(localDate(new Date(), TZ));
  const today = totalsOf(await mealsBetween(s, e));
  const target = Number(await getSetting("daily_kcal_target")) || null;

  const scaled = list.map((i: any) => ({
    name: i.name, qty_desc: i.qty_desc, kcal: Number(i.kcal) * mult,
  }));
  await editMessage(chatId, cq.message.message_id,
    mealReply(meal, scaled, today, target), correctionButtons(mealId));
  await answerCallback(cq.id, `份量改成 ×${mult}`);
}
