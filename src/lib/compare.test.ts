import { describe, expect, test } from "bun:test";
import { diffWords, pageWords, type Word } from "./compare";

const words = (text: string, page = 0): Word[] => text.split(/\s+/).filter(Boolean).map((t) => ({ text: t, page, rects: [] }));
const show = (changes: ReturnType<typeof diffWords>) => changes!.map((c) => `${c.kind}:${c.before.map((w) => w.text).join(" ")}>${c.after.map((w) => w.text).join(" ")}`);

describe("comparing versions", () => {
  test("finds changed, added and removed words", () => {
    const a = words("Harga sewa Rp 10.000.000 per bulan dibayar di muka");
    const b = words("Harga sewa Rp 12.000.000 per bulan dibayar setiap tanggal 5");
    expect(show(diffWords(a, b))).toEqual(["changed:10.000.000>12.000.000", "changed:di muka>setiap tanggal 5"]);
    expect(show(diffWords(words("satu dua tiga"), words("satu tiga")))).toEqual(["removed:dua>"]);
    expect(show(diffWords(words("satu tiga"), words("satu dua tiga")))).toEqual(["added:>dua"]);
  });

  test("the same text is no change, wherever the pages break", () => {
    const a = [...words("Pasal 1 Para pihak", 0), ...words("sepakat sebagai berikut", 1)];
    const b = [...words("Pasal 1", 0), ...words("Para pihak sepakat sebagai berikut", 1)];
    expect(diffWords(a, b)).toEqual([]);
  });

  test("says on which page of each version a change is", () => {
    const a = [...words("Halaman satu", 0), ...words("denda 2%", 1)];
    const b = [...words("Halaman satu", 0), ...words("denda 5%", 1)];
    const [c] = diffWords(a, b)!;
    expect([c.pageBefore, c.pageAfter]).toEqual([1, 1]);
  });

  test("gives up on versions too different to compare word by word", () => {
    const a = words(Array.from({ length: 400 }, (_, i) => `a${i}`).join(" "));
    const b = words(Array.from({ length: 400 }, (_, i) => `b${i}`).join(" "));
    expect(diffWords(a, b, 100)).toBeNull();
  });

  test("joins the pieces of a word drawn as separate items", () => {
    const item = (str: string, x: number, width: number) => ({ str, transform: [10, 0, 0, 10, x, 700], width, height: 10 });
    // "Perjanjian" drawn as "Perjan" + "jian", then " baru".
    const found = pageWords([item("Perjan", 100, 30), item("jian", 130, 20), item(" baru", 150, 25)], [1, 0, 0, -1, 0, 792], 0);
    expect(found.map((w) => w.text)).toEqual(["Perjanjian", "baru"]);
    expect(found[0].rects.length).toBe(2);
  });
});
