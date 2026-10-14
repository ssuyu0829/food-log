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
import {
  calibReport, correctionButtons, daySummary, itemButtons, mealReply, weekReport, weightReport,
} from "../_shared/format.ts";
import {
  dayBounds, groupByDay, lastNDays, logicalDate, mealsBetween, proteinTargetG, TARGETS, totalsOf,
} from "../_shared/stats.ts";
import { calibrate, parseWeight, type WeighIn } from "../_shared/weight.ts";
import { getItems, recalcMeal } from "../_shared/meal.ts";
import { parsePortion } from "../_shared/portion.ts";


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
        "  沒講甜度＝<b>無糖</b>，沒講杯型＝<b>大杯</b>。所以只打 <code>鮮奶茶</code> 就是無糖大杯。",
        "",
        "<b>指令</b>",
        "/today 今天吃了什麼　/week 本週回顧",
        "/target 1800 設每日熱量目標（/target 0 取消）",
        "/undo 刪掉最後一筆　/help 說明",
        "",
        "<b>記完之後還能改</b>",
        "• <b>回覆</b>那則訊息打一個數字＝自訂份量（<code>0.7</code>、<code>2/3</code>）",
        "• 按 <b>✂️ 挑掉某一項</b> 可以把別人的那盤劃掉，按一下劃掉、再按一下加回來",
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

  // 回覆 bot 那則記錄訊息 ＋ 一個數字＝自訂份量倍率。
  // 認不出數字就原路往下走，所以「回覆某則訊息順手記另一樣東西」不會被吃掉。
  const replyTo = msg.reply_to_message?.message_id;
  if (replyTo && await handlePortionReply(chatId, replyTo, text)) return;

  if (text.startsWith("/")) return await handleCommand(chatId, text);

  // 體重。一定要在手搖查表之前攔下來，否則「62.5kg」會被丟給 AI 當食物估。
  const w = parseWeight(text);
  if (w) return await saveWeight(chatId, w);

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
        "  沒講甜度＝<b>無糖</b>，沒講杯型＝<b>大杯</b>（<code>鮮奶茶</code> = 無糖大杯）",
        "",
        "<b>指令</b>",
        "/today 今天　/week 本週",
        "/target 1800 設每日目標（/target 0 取消）",
        "/limit 3 設每週手搖上限（只出現在統計裡，不會當場念你）",
        "/undo 刪掉最後一筆　/app 拿報表網址",
        "",
        "<b>體重（2026-09-10 加）</b>",
        "• 打 <code>體重 62.5</code>（也認 <code>62.5kg</code>、<code>62.5 公斤</code>）",
        "  補登：<code>9/8 體重 62.3</code>。<b>裸數字不算</b>，那是份量倍率。",
        "/weight 看曲線　/calib 由體重反推熱量校準　/tdee 設參考值",
        "/protein 1.6 設蛋白質倍率（g/kg，預設 1.2）。有體重才會出現蛋白質目標。",
        "<i>體重是唯一能從外部驗證熱量估得準不準的東西。</i>",
        "",
        "<b>記完之後還能改</b>",
        "• <b>回覆</b>那則訊息打一個數字＝自訂份量（<code>0.7</code>、<code>2/3</code>、<code>×1.25</code>）",
        "• <b>✂️ 挑掉某一項</b>：拍到別人的食物時把那一項劃掉，可以再按回來",
        "• 份量與挑掉是兩個獨立的維度，按「還原」只還原倍率，不會把劃掉的加回來",
      ].join("\n"));

    case "/today": {
      const [s, e] = dayBounds(logicalDate());
      const rows = await mealsBetween(s, e);
      const target = Number(await getSetting("daily_kcal_target")) || null;
      return await sendMessage(chatId, daySummary(rows, target, "<b>今天</b>", await proteinTargetG()));
    }

    case "/week": {
      const [s, e, days] = lastNDays(7);
      const rows = await mealsBetween(s, e);
      const prevStart = new Date(new Date(s).getTime() - 7 * 86400000).toISOString();
      const prev = await mealsBetween(prevStart, s);
      return await sendMessage(chatId, weekReport(rows, days, prev, await proteinTargetG()));
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

    case "/weight":
    case "/w": {
      return await sendMessage(chatId, weightReport(await loadWeights(180)));
    }

    case "/calib": {
      // 只用「看起來記完整」的天算平均攝取——漏記會把反推的 TDEE 拉到沒有意義。
      const [s0, e0, days] = lastNDays(60);
      const rows = await mealsBetween(s0, e0);
      const byDay = groupByDay(rows);
      const daily = days.map((d) => {
        const rs = byDay.get(d) ?? [];
        return { date: d, kcal: totalsOf(rs).kcal, recordCount: rs.length };
      }).filter((d) => d.recordCount > 0);
      const ref = Number(await getSetting("ref_tdee")) || null;
      return await sendMessage(chatId, calibReport(calibrate(await loadWeights(60), daily, ref), ref));
    }

    case "/tdee": {
      const v = args[0] ?? "";
      if (!/^\d+$/.test(v)) {
        return await sendMessage(chatId, [
          "用法：<code>/tdee 2100</code>（傳 0 取消）",
          "",
          "這是<b>你自己</b>提供的每日總消耗參考值，/calib 會拿它來對照。",
          "<i>不設也可以——不設的話 /calib 只報「由體重反推的 TDEE」，不給比值。",
          "我不會偷偷套一個公式 TDEE 上去，再宣稱「你高估了 X%」。</i>",
        ].join("\n"));
      }
      await setSetting("ref_tdee", v === "0" ? "" : v);
      return await sendMessage(chatId, v === "0"
        ? "已取消參考 TDEE，/calib 之後只報反推值。"
        : `參考 TDEE 設成 ${v} kcal/天。/calib 會拿它對照。`);
    }

    case "/protein": {
      // 蛋白質目標＝最新體重 × 倍率。這裡只設倍率，體重走「體重 62.5」那條路。
      const v = args[0] ?? "";
      if (!v) {
        const t = await proteinTargetG();
        const perKg = Number(await getSetting("protein_per_kg")) || TARGETS.protein_per_kg;
        return await sendMessage(chatId, t === null
          ? `還沒有體重記錄，算不出蛋白質目標。先打 <code>體重 62.5</code>。`
          : `目前蛋白質目標 <b>${t} g/天</b>（最新體重 × ${perKg} g/kg）。\n用 <code>/protein 1.6</code> 改倍率，<code>/protein 0</code> 回預設 ${TARGETS.protein_per_kg}。`);
      }
      if (!/^\d+(\.\d+)?$/.test(v) || Number(v) > 4) {
        return await sendMessage(chatId, "用法：<code>/protein 1.6</code>（每公斤體重幾克，0 回預設）");
      }
      await setSetting("protein_per_kg", Number(v) === 0 ? "" : v);
      const t = await proteinTargetG();
      return await sendMessage(chatId, Number(v) === 0
        ? `倍率回到預設 ${TARGETS.protein_per_kg} g/kg。` + (t !== null ? `目標 ${t} g/天。` : "")
        : `倍率設成 ${v} g/kg。` + (t !== null ? `目標 <b>${t} g/天</b>。` : "還沒有體重記錄，記了之後就會算。"));
    }

    case "/app": {
      const url = await getSetting("pwa_url");
      return await sendMessage(chatId, url
        ? [
            `報表：${url}`,
            "",
            "用 <b>Safari</b> 開 → 分享 → 加入主畫面。",
            "⚠️ 網址結尾 <code>?t=…</code> 那段不要刪，主畫面圖示要靠它認人。",
          ].join("\n")
        : "PWA 還沒設定網址。等前端上線後，把<b>帶 ?t= 的完整網址</b>填進 settings 表的 pwa_url。");
    }

    default:
      return await sendMessage(chatId, "不認識這個指令，試試 /help");
  }
}

// ------------------------------------------------------------
// 體重
// ------------------------------------------------------------
async function loadWeights(days: number): Promise<WeighIn[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db.from("weights")
    .select("measured_at,kg").gte("measured_at", since)
    .order("measured_at", { ascending: true });
  return (data ?? []).map((r: any) => ({ at: new Date(r.measured_at), kg: Number(r.kg) }));
}

async function saveWeight(chatId: number, w: { kg: number; date: string | null }) {
  // 補登時記在那天的中午——沒有時刻資訊，用正午最不會被日界線咬到
  const measured_at = w.date ? new Date(`${w.date}T12:00:00+08:00`).toISOString()
                             : new Date().toISOString();
  const { error } = await db.from("weights").insert({ kg: w.kg, measured_at });
  if (error) throw error;

  const all = await loadWeights(90);
  const prev = all.length > 1 ? all[all.length - 2] : null;
  const delta = prev ? Math.round((w.kg - prev.kg) * 10) / 10 : null;

  return await sendMessage(chatId, [
    `⚖️ 記好了：<b>${w.kg} kg</b>` + (w.date ? `（${w.date.slice(5).replace("-", "/")}）` : ""),
    delta !== null ? `比上一次 ${delta > 0 ? "+" : ""}${delta} kg` : "",
    all.length >= 10 ? "<i>/calib 看由體重反推的熱量校準</i>"
      : `<i>再量 ${10 - all.length} 次就能跑 /calib（要 10 次以上、橫跨 21 天才會下結論）</i>`,
  ].filter(Boolean).join("\n"));
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
  const day = logicalDate();
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${day}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) console.error("照片上傳失敗（記錄仍會存）:", upErr);

  await saveAndReply(chatId, msg, analysis, {
    source: "photo", photo_path: upErr ? null : path, raw_text: caption || null,
  });
}

/**
 * 「回覆那則記錄訊息 + 打一個數字」＝改份量。
 * 回 true 代表已經處理掉了；回 false 代表這則訊息不是在改份量，呼叫端要照原路走。
 */
async function handlePortionReply(chatId: number, replyTo: number, text: string): Promise<boolean> {
  const parsed = parsePortion(text);
  if (!parsed) return false;

  const { data: meal } = await db.from("meals").select("id,title")
    .eq("tg_reply_message_id", replyTo).is("deleted_at", null).maybeSingle();
  if (!meal) return false;

  if (parsed.kind === "out_of_range") {
    await sendMessage(chatId,
      `${parsed.value} 看起來是熱量不是倍率。這裡只吃<b>倍率</b>——只吃了七成就打 <code>0.7</code>。`);
    return true;
  }

  const r = await recalcMeal(meal.id, parsed.value);
  if (!r) return false;

  await redraw(chatId, replyTo, meal.id);
  await sendMessage(chatId,
    `已把「${esc(r.meal.title ?? "")}」改成 ×${parsed.value} → <b>${r.meal.total_kcal}</b> kcal`);
  return true;
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
        // 配方路徑算得出蛋白／脂肪／鈉／飽和脂肪／添加糖；退路（網搜列）那幾欄是 null。
        items: [{
          name: hit.title,
          qty_desc: [parsed.size === "L" ? "大杯" : "中杯", parsed.ice].filter(Boolean).join(" "),
          kcal: hit.kcal, protein_g: hit.protein_g, fat_g: hit.fat_g,
          carb_g: hit.carb_g, sugar_g: hit.sugar_g,
          sodium_mg: hit.sodium_mg, fiber_g: hit.fiber_g, sat_fat_g: hit.sat_fat_g,
          added_sugar_g: hit.added_sugar_g, veg_servings: hit.veg_servings,
        }],
        total_kcal: hit.kcal, protein_g: hit.protein_g, fat_g: hit.fat_g,
        carb_g: hit.carb_g, sugar_g: hit.sugar_g,
        sodium_mg: hit.sodium_mg, fiber_g: hit.fiber_g, sat_fat_g: hit.sat_fat_g,
        added_sugar_g: hit.added_sugar_g, veg_servings: hit.veg_servings,
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
    : "推估值（非官方數字，由配方模型算出，誤差約 ±15%）";
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
    // 五個新維度。null 會照樣寫成 NULL＝「這條路徑沒量」，不要 ?? 0。
    sodium_mg: a.sodium_mg, fiber_g: a.fiber_g, sat_fat_g: a.sat_fat_g,
    added_sugar_g: a.added_sugar_g, veg_servings: a.veg_servings,
    confidence: a.confidence, estimate_note: a.note || null, model: a.model,
    tg_chat_id: chatId, tg_message_id: msg.message_id,
    ...extra,
  }).select().single();
  if (error) throw error;

  if (a.items.length) {
    await db.from("meal_items").insert(a.items.map((it, i) => ({
      meal_id: meal.id, name: it.name, qty_desc: it.qty_desc,
      kcal: it.kcal, protein_g: it.protein_g, fat_g: it.fat_g,
      carb_g: it.carb_g, sugar_g: it.sugar_g,
      sodium_mg: it.sodium_mg, fiber_g: it.fiber_g, sat_fat_g: it.sat_fat_g,
      added_sugar_g: it.added_sugar_g, veg_servings: it.veg_servings,
      ord: i,
    })));
  }

  const [s, e] = dayBounds(logicalDate());
  const today = totalsOf(await mealsBetween(s, e));
  const target = Number(await getSetting("daily_kcal_target")) || null;

  const sent = await sendMessage(chatId,
    mealReply({ ...meal, portion_multiplier: 1 }, a.items, today, target),
    correctionButtons(meal.id, a.items.length));

  // 記住這則回覆的 id：之後「回覆它打一個數字」才對得回是哪一筆
  if (sent?.message_id) {
    await db.from("meals").update({ tg_reply_message_id: sent.message_id }).eq("id", meal.id);
  }
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

  // 補登：把整筆往前／往後移一天。在現有時間上加減，所以按幾次就移幾天，
  // 也不會把使用者原本記的時刻弄丟。
  if (kind === "day") {
    const delta = Number(multStr);
    if (!Number.isFinite(delta) || delta === 0) return await answerCallback(cq.id);

    const { data: cur } = await db.from("meals").select("eaten_at").eq("id", mealId).single();
    if (!cur) return await answerCallback(cq.id, "找不到這筆");

    const moved = new Date(new Date(cur.eaten_at).getTime() + delta * 86_400_000).toISOString();
    await db.from("meals").update({ eaten_at: moved }).eq("id", mealId);

    await redraw(chatId, cq.message.message_id, mealId);
    return await answerCallback(cq.id, `搬到 ${logicalDate(new Date(moved))}`);
  }

  // 挑掉細項：同一則訊息把鍵盤換成細項清單，狀態全部在資料庫，bot 不用記東西
  if (kind === "items") {
    const ok3 = await redraw(chatId, cq.message.message_id, mealId, "items");
    return await answerCallback(cq.id, ok3 ? "按一下劃掉，再按一下加回來" : "找不到這筆");
  }

  if (kind === "done") {
    await redraw(chatId, cq.message.message_id, mealId);
    return await answerCallback(cq.id);
  }

  if (kind === "it") {
    const itemId = Number(multStr);
    const { data: item } = await db.from("meal_items").select("id,name,excluded")
      .eq("id", itemId).eq("meal_id", mealId).maybeSingle();
    if (!item) return await answerCallback(cq.id, "找不到這一項");

    await db.from("meal_items").update({ excluded: !item.excluded }).eq("id", itemId);
    await recalcMeal(mealId); // 倍率沿用現值，只是重新加總「沒被挑掉的」
    await redraw(chatId, cq.message.message_id, mealId, "items");
    return await answerCallback(cq.id, item.excluded ? `加回「${item.name}」` : `挑掉「${item.name}」`);
  }

  if (kind !== "m") return await answerCallback(cq.id);

  const mult = Number(multStr);
  if (!Number.isFinite(mult) || mult <= 0) return await answerCallback(cq.id);

  // 從 meal_items 的原始值重算，所以連按 ×2 再按 ×0.5 也會回到正確數字
  const r = await recalcMeal(mealId, mult);
  if (!r) return await answerCallback(cq.id, "找不到這筆");

  await redraw(chatId, cq.message.message_id, mealId);
  return await answerCallback(cq.id, `份量改成 ×${mult}`);
}

/**
 * 重畫一則記錄訊息（份量鍵、改日期鍵、挑細項共用）。
 * 一律從資料庫重讀，所以不管剛剛改的是份量、日期還是挑掉哪一項，畫出來的都是當下的真實狀態。
 * mode="items" 時鍵盤換成細項清單，訊息本文完全一樣。
 */
async function redraw(
  chatId: number, messageId: number, mealId: number, mode: "normal" | "items" = "normal",
): Promise<boolean> {
  const { data: meal } = await db.from("meals").select("*").eq("id", mealId).single();
  if (!meal) return false;

  const items = await getItems(mealId);
  const mult = Number(meal.portion_multiplier ?? 1);
  const scaled = items.map((i) => ({
    name: i.name, qty_desc: i.qty_desc ?? "", kcal: Number(i.kcal ?? 0) * mult,
    excluded: i.excluded,
  }));

  // 累計看的是「這筆所屬的那一天」，不是今天——搬到 9/4 之後要顯示 9/4 的總量
  const [s, e] = dayBounds(logicalDate(new Date(meal.eaten_at)));
  const dayTotals = totalsOf(await mealsBetween(s, e));
  const target = Number(await getSetting("daily_kcal_target")) || null;

  await editMessage(chatId, messageId, mealReply(meal, scaled, dayTotals, target),
    mode === "items"
      ? itemButtons(mealId, items.map((i) => ({
          id: i.id, name: i.name, kcal: Number(i.kcal ?? 0) * mult, excluded: i.excluded,
        })))
      : correctionButtons(mealId, items.length));
  return true;
}
