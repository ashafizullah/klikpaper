import { describe, expect, test } from "bun:test";
import type { PageItem } from "./doc.svelte";
import { currentBookmark, dropPages, indent, insertionIndex, move, outdent, outlineSpec, type Bookmark } from "./outline";

const page = (id: string, sheet = false): PageItem => ({ id, source: "s", index: 0, own: 0, rotate: 0, w: 600, h: 800, ...(sheet ? { sheet: { w: 595, h: 842, margin: 0 } } : {}) });
const b = (id: string, pageId: string | null, children: Bookmark[] = []): Bookmark => ({ id, title: id, page: pageId, y: 100, open: true, children });

describe("outline", () => {
  test("moves, indents and outdents", () => {
    const list = [b("a", "p1"), b("b", "p2"), b("c", "p3")];
    expect(move(list, "c", -1)).toBe(true);
    expect(list.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(move(list, "a", -1)).toBe(false);
    expect(indent(list, "c")).toBe(true);
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
    expect(list[0].children.map((x) => x.id)).toEqual(["c"]);
    expect(indent(list, "a")).toBe(false);
    expect(outdent(list, "c")).toBe(true);
    expect(list.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(outdent(list, "a")).toBe(false);
  });

  test("dropping a page keeps the children of its bookmark", () => {
    const list = [b("a", "p1", [b("a1", "p2"), b("a2", "p3")]), b("z", "p4")];
    expect(dropPages(list, new Set(["p1", "p4"]))).toBe(true);
    expect(list.map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(dropPages(list, new Set(["p9"]))).toBe(false);
  });

  test("writes positions in the output and leaves out pages not in it", () => {
    const pages = [page("p1"), page("p2", true), page("p3")];
    const list = [b("a", "p1", [b("a1", "p3")]), b("b", "p2"), { ...b("web", null), url: "https://example.com" }];
    // Only the second and third pages, in reverse order.
    const spec = outlineSpec(list, pages, [2, 1]);
    expect(spec.map((s) => [s.title, s.page, s.y])).toEqual([
      ["a1", 0, 100],
      ["b", 1, null],
      ["web", null, null],
    ]);
    expect(spec[2].url).toBe("https://example.com");
  });

  test("finds the bookmark for the current page and where inserted ones go", () => {
    const pages = [page("p1"), page("p2"), page("p3")];
    const list = [b("a", "p1", [b("a1", "p2")]), b("c", "p3")];
    expect(currentBookmark(list, pages, 0)).toBe("a");
    expect(currentBookmark(list, pages, 1)).toBe("a1");
    expect(currentBookmark(list, pages, 2)).toBe("c");
    expect(insertionIndex(list, pages, 0)).toBe(0);
    expect(insertionIndex(list, pages, 2)).toBe(1);
    expect(insertionIndex(list, pages, 3)).toBe(2);
  });
});
