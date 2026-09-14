/* 飲食帳本 — 前端。不碰任何金鑰，只用 ?t=<token> 跟 report function 要資料。 */
(() => {
  "use strict";

  const CFG = window.FOODLOG_CONFIG || {};
  const LS_TOKEN = "foodlog.token";
  const LS_SNAPSHOT = "foodlog.snapshot";
  const DAYS = 14;

  const $ = (id) => document.getElementById(id);
  const WD = ["日", "一", "二", "三", "四", "五", "六"];

  // ---------- token ----------
  // ⚠️ 2026-09-06：這裡原本讀完 token 就把 ?t= 從網址擦掉，理由寫「圖示才不會一直帶著
  // token」——方向是反的。「加到主畫面」抓的是當下那條網址，擦掉之後圖示就是沒 token 的版本；
  // iOS 主畫面 App 又跟 Safari 用不同的 localStorage，看不到瀏覽器存的 token。
  // 結果圖示永遠停在「還沒認證」，而唯一能拿 token 的 /app 只會在 Safari 開 → 死結。
  // 現在反過來：網址永遠自帶 token，捷徑才會是能用的。
  const urlToken = new URLSearchParams(location.search).get("t");
  if (urlToken) localStorage.setItem(LS_TOKEN, urlToken);
  const token = localStorage.getItem(LS_TOKEN);
  if (token && !urlToken) history.replaceState(null, "", `?t=${encodeURIComponent(token)}`);

  /** 從貼進來的東西取出 token：整條網址、只有 ?t=xxx、或裸 token 都吃 */
  function extractToken(s) {
    const v = String(s || "").trim();
    return (v.match(/[?&]t=([^&#\s]+)/)?.[1] ?? v).trim();
  }

  async function boot() {
    if (!token) {
      // 給貼上的入口，讓「沒 token」不再是死路——不依賴 iOS 的 localStorage 行為
      return showState("這台裝置還沒認證。\n在 Telegram 打 /app，把整條網址貼到下面。", true);
    }
    if (!CFG.API_BASE || CFG.API_BASE.includes("YOUR-PROJECT-REF")) {
      return showState("config.js 裡的 API_BASE 還沒填。");
    }

    const cached = readSnapshot();
    if (cached) render(cached, true);

    try {
      const res = await fetch(`${CFG.API_BASE}/report?t=${encodeURIComponent(token)}&days=${DAYS}`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        localStorage.removeItem(LS_TOKEN);
        return showState("token 失效了。\n在 Telegram 打 /app 重新拿一次，貼到下面。", true);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      localStorage.setItem(LS_SNAPSHOT, JSON.stringify({ at: Date.now(), data }));
      render(data, false);
    } catch (err) {
      if (cached) markStale(cached.__at);
      else showState(`連不上伺服器。\n${err.message}`);
    }
  }

  function readSnapshot() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SNAPSHOT) || "null");
      if (!raw?.data) return null;
      raw.data.__at = raw.at;
      return raw.data;
    } catch { return null; }
  }

  function showState(msg, askToken = false) {
    $("state").hidden = false;
    $("state-msg").textContent = msg;
    $("state-auth").hidden = !askToken;
    ["today", "chart", "entries"].forEach((id) => { $(id).hidden = true; });
  }

  // 貼上 token：整條網址或裸 token 都收，存好之後用帶 token 的網址重新載入
  $("state-auth-go").addEventListener("click", () => {
    const t = extractToken($("state-auth-input").value);
    if (!t) return;
    localStorage.setItem(LS_TOKEN, t);
    location.replace(`?t=${encodeURIComponent(t)}`);
  });
  $("state-auth-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("state-auth-go").click();
  });

  function markStale(at) {
    $("stamp").textContent = `離線・上次同步 ${at ? fmtWhen(at) : "未知"}`;
  }

  // ---------- 繪製 ----------
  function render(d, isCache) {
    $("state").hidden = true;
    ["today", "chart", "entries"].forEach((id, i) => {
      const el = $(id);
      el.hidden = false;
      el.classList.add("reveal");
      el.style.animationDelay = `${i * 90}ms`;
    });

    const today = d.days.find((x) => x.date === d.today) ?? blankDay(d.today);
    const week = d.days.slice(-7);

    // 報頭
    $("today-label").textContent = fmtDateLabel(d.today);

    // 印章：近 7 天手搖杯數
    const cups = week.reduce((s, x) => s + x.drinkCount, 0);
    $("seal-n").textContent = cups;
    $("seal").classList.toggle("is-quiet", cups === 0);
    $("seal").title = d.drink_limit
      ? `近 7 天 ${cups} / ${d.drink_limit} 杯`
      : `近 7 天 ${cups} 杯`;

    // 今日
    $("today-kcal").textContent = Math.round(today.kcal).toLocaleString();
    renderTarget(today, d.target);
    renderMacros(today);
    renderTargets(today, d.targets);

    // 七日
    renderChart(week, d.today, d.target);

    // 明細
    renderEntries(d.meals);

    $("stamp").textContent = isCache
      ? `離線・上次同步 ${d.__at ? fmtWhen(d.__at) : "未知"}`
      : `同步於 ${fmtWhen(Date.now())}`;
  }

  const blankDay = (date) => ({
    date, kcal: 0, sugar_g: 0, protein_g: 0, fat_g: 0, carb_g: 0,
    drinkCount: 0, mealCount: 0, drinkKcal: 0,
    // ⚠️ 這五個的空值是 null 不是 0。null = 沒量過（2026-09-10 之前的紀錄全是），
    //    0 = 量過答案是零。畫成 0 會讓人以為那天真的沒吃到鈉。
    sodium_mg: null, fiber_g: null, sat_fat_g: null, added_sugar_g: null, veg_servings: null,
  });

  function renderTarget(today, target) {
    const bar = $("today-bar"), fill = $("today-fill"), verdict = $("today-verdict");
    verdict.className = "today__verdict";

    if (!target) {
      bar.hidden = true;
      verdict.textContent = today.kcal
        ? `${today.mealCount} 餐、${today.drinkCount} 杯手搖・糖 ${round1(today.sugar_g)}g`
        : "今天還沒有任何記錄。";
      return;
    }

    bar.hidden = false;
    const pct = Math.min(100, (today.kcal / target) * 100);
    const over = today.kcal > target;
    bar.classList.toggle("is-over", over);
    requestAnimationFrame(() => { fill.style.width = `${pct}%`; });

    verdict.classList.add(over ? "is-over" : "is-under");
    verdict.textContent = over
      ? `超過目標 ${Math.round(today.kcal - target)} kcal（目標 ${target}）`
      : `距離目標還有 ${Math.round(target - today.kcal)} kcal（目標 ${target}）`;
  }

  function renderMacros(today) {
    $("macros").innerHTML = [
      ["糖", `${round1(today.sugar_g)}`, "g"],
      ["蛋白", `${Math.round(today.protein_g)}`, "g"],
      ["脂肪", `${Math.round(today.fat_g)}`, "g"],
      ["碳水", `${Math.round(today.carb_g)}`, "g"],
    ].map(([k, v, u]) => `<div><dt>${k}</dt><dd>${v}<small>${u}</small></dd></div>`).join("");
  }

  // 2026-09-10：健康指標。
  // ⚠️ 門檻由後端的 report function 給（stats.ts 的 TARGETS），前端不要另外寫死一份，
  //    不然兩邊會漂移——這個專案已經在 DAY_START_HOUR 上吃過一次同樣的虧。
  function renderTargets(today, targets) {
    const el = $("targets");
    if (!targets) { el.hidden = true; return; }
    const rows = [
      ["鈉", today.sodium_mg, targets.sodium_mg, "mg", true],
      ["添加糖", today.added_sugar_g, targets.added_sugar_g, "g", true],
      ["飽和脂肪", today.sat_fat_g, targets.sat_fat_g, "g", true],
      ["膳食纖維", today.fiber_g, targets.fiber_g, "g", false],
      ["蔬菜", today.veg_servings, targets.veg_servings, " 份", false],
    ].filter(([, v]) => v !== null && v !== undefined);   // 沒量過的整項不畫

    if (!rows.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = rows.map(([k, v, t, u, over]) => {
      const bad = over ? v > t : v < t;
      const pct = Math.min(100, (v / t) * 100);
      return `<li class="tgt${bad ? " is-bad" : ""}">
        <span class="tgt__k">${k}</span>
        <span class="tgt__track"><span class="tgt__bar" style="width:${pct}%"></span></span>
        <span class="tgt__v">${round1(v)}${u} / ${t}${u}</span>
      </li>`;
    }).join("");

    // 修掉 2026-09-10 之前最誤導的口徑：「糖」是總糖，WHO 的門檻講的是游離糖
    if (today.added_sugar_g !== null && today.sugar_g > today.added_sugar_g) {
      const nat = round1(today.sugar_g - today.added_sugar_g);
      el.innerHTML += `<li class="tgt__note">總糖 ${round1(today.sugar_g)}g 裡有 ${nat}g 是乳糖／果糖，不算進添加糖</li>`;
    }
  }

  function renderChart(week, todayStr, target) {
    const max = Math.max(1, ...week.map((x) => x.kcal), target || 0);
    $("chart-rows").innerHTML = week.map((x) => {
      const isToday = x.date === todayStr;
      const over = target && x.kcal > target;
      const dots = "<i></i>".repeat(Math.min(x.drinkCount, 6));
      return `
        <div class="day${isToday ? " is-today" : ""}">
          <span class="day__label">${x.date.slice(5).replace("-", "/")} ${WD[weekday(x.date)]}</span>
          <span class="day__track">
            <span class="day__bar${over ? " is-over" : ""}" data-w="${(x.kcal / max) * 100}"></span>
            <span class="day__drinks" style="left:${(x.kcal / max) * 100}%">${dots}</span>
          </span>
          <span class="day__kcal">${x.kcal ? Math.round(x.kcal) : "–"}</span>
        </div>`;
    }).join("");

    requestAnimationFrame(() => {
      document.querySelectorAll(".day__bar").forEach((el, i) => {
        setTimeout(() => { el.style.width = `${el.dataset.w}%`; }, i * 55);
      });
    });

    const logged = week.filter((x) => x.kcal > 0).length;
    const avg = logged ? Math.round(week.reduce((s, x) => s + x.kcal, 0) / logged) : 0;
    const sugar = round1(week.reduce((s, x) => s + x.sugar_g, 0));
    // 平均值一定要標「只算了幾天」。9/7 只記 3 筆、9/8 只記 2 筆時，
    // 那兩天的數字反而最高——不標的話會被讀成「那天吃很多」。
    $("chart-foot").textContent = logged
      ? `有記錄的 ${logged} 天平均 ${avg} kcal・七日總糖 ${sugar}g（約 ${Math.round(sugar / 4)} 顆方糖）`
      : "近七日沒有任何記錄。";
  }

  function renderEntries(meals) {
    if (!meals.length) {
      $("entries-list").innerHTML = `<li class="entry__meta">還沒有任何記錄。</li>`;
      return;
    }
    let lastDay = "";
    $("entries-list").innerHTML = meals.map((m) => {
      const day = m.eaten_at.slice(0, 10);
      const localDay = fmtDay(m.eaten_at);
      let head = "";
      if (localDay !== lastDay) { head = `<li class="entry__daymark">${localDay}</li>`; lastDay = localDay; }

      const thumb = m.photo
        ? `<img class="entry__thumb" src="${esc(m.photo)}" alt="" loading="lazy" data-full="${esc(m.photo)}">`
        : `<span class="entry__thumb--none">${m.is_drink ? "🥤" : "🍽"}</span>`;

      const meta = [
        fmtTime(m.eaten_at),
        m.sugar_g ? `糖 ${round1(m.sugar_g)}g` : "",
        m.confidence === "low" ? `<span class="low">份量是猜的</span>` : "",
      ].filter(Boolean).join(" ・ ");

      void day;
      return `${head}
        <li class="entry${m.is_drink ? " is-drink" : ""}">
          ${thumb}
          <span class="entry__main">
            <span class="entry__title">${esc(m.title || "未命名")}</span>
            <span class="entry__meta">${meta}</span>
          </span>
          <span class="entry__kcal">${Math.round(m.kcal)}</span>
        </li>`;
    }).join("");
  }

  // ---------- 燈箱 ----------
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".entry__thumb");
    if (img) {
      $("lightbox-img").src = img.dataset.full;
      $("lightbox").hidden = false;
      return;
    }
    if (e.target.closest("#lightbox")) $("lightbox").hidden = true;
  });

  // ---------- 小工具 ----------
  const TZ = "Asia/Taipei";
  const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const weekday = (d) => new Date(`${d}T12:00:00+08:00`).getDay();

  const fmtDateLabel = (d) =>
    `${d.replace(/-/g, ".")} 星期${WD[weekday(d)]}`;
  // 帳本的一天從凌晨 4 點開始（跟後端 stats.ts 的 DAY_START_HOUR 必須一致）：
  // 半夜吃的算前一天。不減這 4 小時的話，明細的日期標會跟上面的長條圖對不起來。
  const DAY_START_HOUR = 4;
  const fmtDay = (iso) =>
    new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, month: "2-digit", day: "2-digit", weekday: "short" })
      .format(new Date(new Date(iso).getTime() - DAY_START_HOUR * 3600e3));
  const fmtTime = (iso) =>
    new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(iso));
  const fmtWhen = (ms) =>
    new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(ms));

  // ---------- Service Worker ----------
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // 啟動放最後：上面那些 const 工具函式要先初始化完（否則會踩到 TDZ）
  boot();
})();
