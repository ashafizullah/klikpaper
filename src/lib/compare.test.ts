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

  test("matches a plain longest-common-subsequence on random edits, and stays small on long documents", () => {
    // Reference: classic LCS length, which the edit script must reach.
    const lcs = (x: string[], y: string[]) => {
      const t = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
      for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) t[i][j] = x[i - 1] === y[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
      return t[x.length][y.length];
    };
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 40; round++) {
      const a = Array.from({ length: 30 + Math.floor(rand() * 30) }, () => `w${Math.floor(rand() * 8)}`);
      const b = a.filter(() => rand() > 0.2).flatMap((w) => (rand() > 0.85 ? [w, `w${Math.floor(rand() * 8)}`] : [w]));
      const changes = diffWords(words(a.join(" ")), words(b.join(" ")))!;
      const removed = changes.reduce((s, c) => s + c.before.length, 0);
      const added = changes.reduce((s, c) => s + c.after.length, 0);
      const common = lcs(a, b);
      expect(a.length - removed).toBe(common);
      expect(b.length - added).toBe(common);
    }
    // 60 000 words with a handful of changes: quick, and no large copies per step.
    const long = Array.from({ length: 60000 }, (_, i) => `k${i % 997}`);
    const edited = [...long];
    edited.splice(30000, 3, "baru", "kata");
    const started = performance.now();
    const changes = diffWords(words(long.join(" ")), words(edited.join(" ")))!;
    expect(changes.length).toBe(1);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("joins the pieces of a word drawn as separate items", () => {
    const item = (str: string, x: number, width: number) => ({ str, transform: [10, 0, 0, 10, x, 700], width, height: 10 });
    // "Perjanjian" drawn as "Perjan" + "jian", then " baru".
    const found = pageWords([item("Perjan", 100, 30), item("jian", 130, 20), item(" baru", 150, 25)], [1, 0, 0, -1, 0, 792], 0);
    expect(found.map((w) => w.text)).toEqual(["Perjanjian", "baru"]);
    expect(found[0].rects.length).toBe(2);
  });
});
