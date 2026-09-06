import { assertEquals } from "jsr:@std/assert@1";
import { dayBounds, lastNDays, logicalDate, DAY_START_HOUR } from "./stats.ts";

Deno.test("凌晨 4 點前算前一天", () => {
  assertEquals(DAY_START_HOUR, 4);
  const cases: [string, string][] = [
    ["2026-09-05T00:30:00+08:00", "2026-09-04"], // 紅油抄手原本那筆
    ["2026-09-05T03:59:00+08:00", "2026-09-04"], // 邊界前一分鐘
    ["2026-09-05T04:00:00+08:00", "2026-09-05"], // 邊界當下
    ["2026-09-04T23:30:00+08:00", "2026-09-04"], // 改過之後那筆
    ["2026-09-06T12:00:00+08:00", "2026-09-06"], // 正常白天
    ["2026-01-01T02:00:00+08:00", "2025-12-31"], // 跨年
    ["2026-03-01T01:00:00+08:00", "2026-02-28"], // 跨月
  ];
  for (const [iso, want] of cases) assertEquals(logicalDate(new Date(iso)), want, iso);
});

Deno.test("dayBounds 是 04:00 到隔日 04:00", () => {
  const [s, e] = dayBounds("2026-09-04");
  assertEquals(s, new Date("2026-09-04T04:00:00+08:00").toISOString());
  assertEquals(e, new Date("2026-09-05T04:00:00+08:00").toISOString());
  // 兩筆紅油抄手（00:30）必須落在 9/4 這個區間裡
  const t = new Date("2026-09-05T00:30:00+08:00").toISOString();
  assertEquals(t >= s && t < e, true);
});

Deno.test("lastNDays 天數與端點", () => {
  const [s, e, days] = lastNDays(7);
  assertEquals(days.length, 7);
  assertEquals(days[6], logicalDate());          // 最後一天＝今天
  assertEquals(s, dayBounds(days[0])[0]);        // 起點對齊第一天的 04:00
  assertEquals(e, dayBounds(days[6])[1]);        // 終點對齊最後一天的隔日 04:00
  // 日期字串必須連續、不重複
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(`${days[i - 1]}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() + 1);
    assertEquals(days[i], prev.toISOString().slice(0, 10));
  }
});
