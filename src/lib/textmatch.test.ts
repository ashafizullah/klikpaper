import { describe, expect, test } from "bun:test";
import { findTextRects, type TextItem } from "./textmatch";

// A US Letter page: pdf.js's viewport transform at scale 1, rotation 0.
const TO_PAGE = [1, 0, 0, -1, 0, 792];
const item = (str: string, x: number, baseline: number, size = 10, width = str.length * size * 0.5): TextItem => ({
  str,
  transform: [size, 0, 0, size, x, baseline],
  width,
  height: size,
});

describe("findTextRects", () => {
  test("finds a word inside an item, case-insensitively", () => {
    const [[r]] = findTextRects([item("Hello World", 100, 700)], "world", TO_PAGE);
    // "World" is chars 6-11 of 11, each 5pt wide.
    expect(r.x).toBeCloseTo(130);
    expect(r.w).toBeCloseTo(25);
    // Baseline at y = 792 - 700 = 92 (top-left origin), cap height above it.
    expect(r.y).toBeCloseTo(92 - 9);
    expect(r.y + r.h).toBeCloseTo(92 + 2.2);
  });

  test("returns every occurrence", () => {
    expect(findTextRects([item("ab ab ab", 0, 700)], "ab", TO_PAGE)).toHaveLength(3);
  });

  test("spans items and ignores whitespace between them", () => {
    const hits = findTextRects([item("total", 50, 700), item(" ", 75, 700), item("amount", 80, 700)], "Total Amount", TO_PAGE);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toHaveLength(2);
  });

  test("handles text rotated 90 degrees", () => {
    const vertical: TextItem = { str: "abcd", transform: [0, 10, -10, 0, 300, 100], width: 20, height: 10 };
    const [[r]] = findTextRects([vertical], "bc", TO_PAGE);
    // Runs up the page from y = 100 (user space), i.e. down from 692 in page space.
    expect(r.y).toBeCloseTo(792 - 115);
    expect(r.h).toBeCloseTo(10);
  });

  test("places a match by measured widths when given them", () => {
    // "iiiWW": narrow i's, wide W's; the measured share puts "WW" further right than equal widths would.
    const it = item("iiiWW", 0, 700, 10, 30);
    const share = (_: TextItem, chars: number) => [0, 0.1, 0.2, 0.3, 0.65, 1][chars];
    const [[r]] = findTextRects([it], "ww", TO_PAGE, share);
    expect(r.x).toBeCloseTo(9);
    expect(r.w).toBeCloseTo(21);
  });

  test("no match", () => {
    expect(findTextRects([item("Hello", 0, 700)], "bye", TO_PAGE)).toEqual([]);
  });
});
