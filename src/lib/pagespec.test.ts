import { expect, test } from "bun:test";
import { formatPages, parsePages, splitGroups } from "./pagespec";

test("parses page lists", () => {
  expect(parsePages("1-3, 5", 10)).toEqual([1, 2, 3, 5]);
  expect(parsePages("8-", 10)).toEqual([8, 9, 10]);
  expect(parsePages("-2", 10)).toEqual([1, 2]);
  expect(parsePages("11", 10)).toBeNull();
  expect(parsePages("3-1", 10)).toBeNull();
  expect(parsePages("abc", 10)).toBeNull();
  expect(parsePages("", 10)).toBeNull();
});

test("formats page lists compactly", () => {
  expect(formatPages([5, 1, 2, 3, 3])).toBe("1-3, 5");
});

test("splits by count or by ranges", () => {
  expect(splitGroups(5, { every: 2 })).toEqual([[1, 2], [3, 4], [5]]);
  expect(splitGroups(5, { ranges: "1-2; 3-5" })).toEqual([[1, 2], [3, 4, 5]]);
  expect(splitGroups(5, { ranges: "1-9" })).toBeNull();
  expect(splitGroups(5, { every: 0 })).toBeNull();
});
