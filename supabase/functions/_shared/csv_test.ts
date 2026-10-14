import { assertEquals } from "jsr:@std/assert@1";
import { CSV_BOM, csvCell, toCsv } from "./csv.ts";

Deno.test("CSV：null 是空格不是 0；布林成 1/0；數字照印", () => {
  assertEquals(csvCell(null), "");
  assertEquals(csvCell(undefined), "");
  assertEquals(csvCell(0), "0");
  assertEquals(csvCell(12.5), "12.5");
  assertEquals(csvCell(NaN), "");
  assertEquals(csvCell(true), "1");
});

Deno.test("CSV：逗號、引號、換行要包起來", () => {
  assertEquals(csvCell("排骨便當"), "排骨便當");
  assertEquals(csvCell("a,b"), '"a,b"');
  assertEquals(csvCell('說 "好" 的'), '"說 ""好"" 的"');
  assertEquals(csvCell("第一行\n第二行"), '"第一行\n第二行"');
});

Deno.test("CSV：公式開頭的字串要擋掉", () => {
  assertEquals(csvCell("=1+1"), "'=1+1");
  assertEquals(csvCell("@SUM"), "'@SUM");
  assertEquals(csvCell("+1"), "'+1");
  assertEquals(csvCell("-5"), "'-5");
  assertEquals(csvCell("-微糖"), "-微糖");   // 負號接非數字不是公式
});

Deno.test("CSV：BOM 開頭、CRLF 行尾、最後一行也有換行", () => {
  const s = toCsv(["id", "標題"], [[1, "鮮奶茶"], [2, null]]);
  assertEquals(s, `${CSV_BOM}id,標題\r\n1,鮮奶茶\r\n2,\r\n`);
});
