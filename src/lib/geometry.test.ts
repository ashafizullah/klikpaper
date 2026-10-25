import { expect, test } from "bun:test";
import { displayRectToPage, displayToPage, normRotation, pageToDisplay, rotateOffset, type Rotation } from "./geometry";

test("display and page space round-trip for every rotation", () => {
  for (const r of [0, 90, 180, 270] as Rotation[]) {
    const [dx, dy] = pageToDisplay(100, 40, r, 612, 792);
    expect(displayToPage(dx, dy, r, 612, 792)).toEqual([100, 40]);
  }
  // Turning clockwise moves the top-left corner to the top-right.
  expect(pageToDisplay(0, 0, 90, 612, 792)).toEqual([792, 0]);
});

test("rotation normalizes to quarter turns", () => {
  expect(normRotation(-90)).toBe(270);
  expect(normRotation(450)).toBe(90);
  expect(normRotation(0)).toBe(0);
});

test("offsets rotate counter-clockwise on screen", () => {
  const [x, y] = rotateOffset(1, 0, 90);
  expect(x).toBeCloseTo(0);
  expect(y).toBeCloseTo(-1);
});

test("display rectangles map to page rectangles", () => {
  expect(displayRectToPage({ x: 0, y: 0, w: 10, h: 20 }, 90, 612, 792)).toEqual({ x: 0, y: 782, w: 20, h: 10 });
});
