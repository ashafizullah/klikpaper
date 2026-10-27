import { expect, test } from "bun:test";
import { fitOnSheet, mmToPt, PAPER, sheetFor } from "./paper";

const [A4W, A4H] = PAPER.a4;

test("auto keeps each page's orientation as displayed", () => {
  expect(sheetFor(612, 792, 0, "a4", "auto", 0)).toEqual({ w: A4W, h: A4H, margin: 0 });
  expect(sheetFor(792, 612, 0, "a4", "auto", 0)).toEqual({ w: A4H, h: A4W, margin: 0 });
  // A portrait page turned 90° shows landscape; the sheet is stored unrotated (portrait).
  expect(sheetFor(612, 792, 90, "a4", "auto", 0)).toEqual({ w: A4W, h: A4H, margin: 0 });
});

test("a fixed orientation applies as displayed", () => {
  expect(sheetFor(612, 792, 0, "a4", "landscape", 10)).toEqual({ w: A4H, h: A4W, margin: 10 });
  // Rotated 90°: landscape on screen is portrait in the page's own orientation.
  expect(sheetFor(612, 792, 90, "a4", "landscape", 0)).toEqual({ w: A4W, h: A4H, margin: 0 });
});

test("content is scaled to fit and centered, like the saved file", () => {
  const { s, ox, oy } = fitOnSheet(612, 792, { w: A4W, h: A4H, margin: 0 });
  expect(s).toBeCloseTo(A4W / 612);
  expect(ox).toBeCloseTo(0);
  expect(oy).toBeCloseTo((A4H - 792 * s) / 2);
  const m = fitOnSheet(612, 792, { w: A4W, h: A4H, margin: mmToPt(10) });
  expect(m.ox).toBeCloseTo(mmToPt(10));
});
