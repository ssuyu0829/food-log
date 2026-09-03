// 前端開發用的假資料伺服器。不連 Supabase，也不需要任何金鑰。
// 跑法：deno run --allow-net --allow-read dev/mock-server.ts
// 然後開 http://localhost:8788/?t=demo
const PORT = 8788;
const ROOT = new URL("../pwa/", import.meta.url);

const TZ = "Asia/Taipei";
const localDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function mockReport(days: number) {
  const today = localDate(new Date());
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(`${today}T12:00:00+08:00`);
    d.setDate(d.getDate() - i);
    dayList.push(localDate(d));
  }

  // 固定亂數，每次跑畫面一樣，比較好比對改動
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  const meals: unknown[] = [];
  const names = ["排骨便當", "鮭魚炒飯", "牛肉麵", "超商雞胸沙拉", "滷肉飯＋燙青菜", "義大利麵", "水餃十顆"];
  const drinks = ["50嵐 四季春 微糖 大", "可不可 白玉歐蕾 半糖 中", "清心 多多綠 無糖 大", "迷客夏 大甲芋頭鮮奶 全糖 大"];

  const dayStats = dayList.map((date, di) => {
    const n = di === dayList.length - 1 ? 2 : 2 + Math.floor(rnd() * 2);
    let kcal = 0, sugar = 0, p = 0, f = 0, c = 0, dc = 0, dk = 0, mc = 0;
    for (let i = 0; i < n; i++) {
      const isDrink = rnd() < 0.38;
      const k = isDrink ? 180 + Math.round(rnd() * 420) : 420 + Math.round(rnd() * 480);
      const s = isDrink ? 20 + Math.round(rnd() * 45) : Math.round(rnd() * 14);
      const at = new Date(`${date}T${String(8 + i * 4).padStart(2, "0")}:${String(Math.floor(rnd() * 59)).padStart(2, "0")}:00+08:00`);
      meals.push({
        id: meals.length + 1, eaten_at: at.toISOString(),
        title: isDrink ? drinks[Math.floor(rnd() * drinks.length)] : names[Math.floor(rnd() * names.length)],
        kcal: k, sugar_g: s, protein_g: Math.round(k * 0.05), fat_g: Math.round(k * 0.035), carb_g: Math.round(k * 0.12),
        is_drink: isDrink, confidence: rnd() < 0.25 ? "low" : "medium", note: null, photo: null,
      });
      kcal += k; sugar += s; p += Math.round(k * 0.05); f += Math.round(k * 0.035); c += Math.round(k * 0.12);
      if (isDrink) { dc++; dk += k; } else mc++;
    }
    return { date, kcal, sugar_g: Math.round(sugar * 10) / 10, protein_g: p, fat_g: f, carb_g: c,
             drinkCount: dc, mealCount: mc, drinkKcal: dk };
  });

  meals.sort((a: any, b: any) => b.eaten_at.localeCompare(a.eaten_at));
  return { today, target: 1800, drink_limit: 3, days: dayStats, meals };
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith("/report")) {
    const days = Number(url.searchParams.get("days") ?? 14);
    if (!url.searchParams.get("t")) return new Response(JSON.stringify({ error: "無效的 token" }), { status: 403 });
    return Response.json(mockReport(days), { headers: { "access-control-allow-origin": "*" } });
  }

  // config.js 改指向本機
  if (url.pathname === "/config.js") {
    return new Response(
      `window.FOODLOG_CONFIG={API_BASE:"http://localhost:${PORT}/functions/v1"};`,
      { headers: { "content-type": "application/javascript" } },
    );
  }

  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const file = await Deno.readFile(new URL(name, ROOT));
    const ext = name.split(".").pop()!;
    const type = { html: "text/html", css: "text/css", js: "application/javascript",
                   json: "application/json", png: "image/png", svg: "image/svg+xml" }[ext] ?? "text/plain";
    return new Response(file, { headers: { "content-type": `${type}; charset=utf-8` } });
  } catch {
    return new Response("404", { status: 404 });
  }
});

console.log(`假資料伺服器： http://localhost:${PORT}/?t=demo`);
