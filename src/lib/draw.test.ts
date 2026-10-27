import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFArray, PDFDict, StandardFonts } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";
import { arrowHead, drawOnPdf, numberAnchor, pageLabel, wrapLines } from "./draw";
import { FIRST_BASELINE, firstBaseline } from "./layout";
import type { Overlay, PageNumbers } from "./doc.svelte";

// The fonts the app ships (vite.config.ts copies them over pdf.js's own).
const fontDir = new URL("../../assets/fonts/liberation/", import.meta.url).pathname;
const fonts = async () => ({
  regular: new Uint8Array(readFileSync(fontDir + "LiberationSans-Regular.ttf")),
  bold: new Uint8Array(readFileSync(fontDir + "LiberationSans-Bold.ttf")),
});

test("wraps text at spaces and breaks long words", () => {
  const measure = (s: string) => s.length;
  expect(wrapLines("satu dua tiga empat", measure, 9)).toEqual(["satu dua", "tiga", "empat"]);
  expect(wrapLines("abcdefghij", measure, 4)).toEqual(["abcd", "efgh", "ij"]);
  expect(wrapLines("baris\n\nbaru", measure, 20)).toEqual(["baris", "", "baru"]);
});

test("page labels and positions", () => {
  const pn: PageNumbers = { format: "{n} / {total}", position: "bottom-right", start: 1, size: 10, margin: 20, color: "#000000" };
  expect(pageLabel(pn, 2, 5)).toBe("3 / 5");
  expect(numberAnchor("bottom-right", [600, 800], 30, 10, 20)).toEqual([550, 780]);
  expect(numberAnchor("top-center", [600, 800], 30, 10, 20)).toEqual([285, 28]);
  const [[ax], [bx]] = arrowHead(0, 0, 100, 0, 2);
  expect(ax).toBeLessThan(100);
  expect(bx).toBeLessThan(100);
});

test("draws overlays and adds markup annotations", async () => {
  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  src.addPage([612, 792]).setRotation({ type: "degrees", angle: 90 } as never);
  const bytes = await src.save();
  const overlays: Overlay[] = [
    { id: "t", page: "p1", kind: "text", x: 72, y: 72, w: 200, text: "Halo dunia, ini teks yang cukup panjang", size: 12, color: "#cc0000", rot: 0 },
    { id: "r", page: "p1", kind: "rect", x: 50, y: 300, w: 100, h: 50, color: "#0000ff", fill: null, width: 2 },
    { id: "i", page: "p1", kind: "ink", points: [10, 10, 20, 30, 40, 20], color: "#000000", width: 2 },
    { id: "a", page: "p1", kind: "arrow", x1: 100, y1: 500, x2: 200, y2: 520, color: "#000000", width: 2 },
    { id: "h", page: "p1", kind: "markup", style: "highlight", rects: [{ x: 72, y: 100, w: 200, h: 14 }], color: "#ffd400" },
  ];
  const out = await drawOnPdf(bytes, {
    pages: [{ overlays, rotation: 0 }, { overlays: [{ id: "u", page: "p2", kind: "markup", style: "underline", rects: [{ x: 10, y: 10, w: 50, h: 10 }], color: "#ff0000" }], rotation: 90 }],
    watermark: { text: "RAHASIA", size: 60, opacity: 0.2, color: "#888888", angle: 45 },
    pageNumbers: { format: "{n}", position: "bottom-center", start: 1, size: 10, margin: 24, color: "#000000" },
    flattenForms: false,
    fonts,
  });
  const doc = await PDFDocument.load(out);
  expect(doc.getPageCount()).toBe(2);
  const annots = (i: number) => doc.getPage(i).node.lookup(PDFName.of("Annots"), PDFArray);
  const first = annots(0).lookup(0, PDFDict);
  expect(first.get(PDFName.of("Subtype"))?.toString()).toBe("/Highlight");
  expect(first.lookup(PDFName.of("QuadPoints"), PDFArray).size()).toBe(8);
  expect(annots(1).lookup(0, PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe("/Underline");
  // The embedded font is subset Liberation Sans.
  expect(new TextDecoder("latin1").decode(out)).toContain("LiberationSans");
});

test("the first baseline follows the font's metrics", () => {
  // Liberation Sans (hhea 1854 / -434 per 2048) gives the constant used for the default font.
  expect(firstBaseline(1854, -434, 2048)).toBeCloseTo(FIRST_BASELINE, 3);
  // A font taller than the line box still puts the baseline below its ascent's half-leading.
  expect(firstBaseline(1000, -366, 1000)).toBeCloseTo(0.917, 3);
});

test("text in an installed font embeds that font's file", async () => {
  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  const asked: string[] = [];
  const out = await drawOnPdf(await src.save(), {
    pages: [{ overlays: [{ id: "t", page: "p1", kind: "text", x: 72, y: 72, w: 300, text: "Halo", size: 14, color: "#000000", rot: 0, font: "Some Font", bold: true }], rotation: 0 }],
    watermark: null,
    pageNumbers: null,
    flattenForms: false,
    fonts,
    // Stands in for the installed font: any TrueType file works.
    systemFont: async (family, bold) => {
      asked.push(`${family}/${bold}`);
      return (await fonts()).bold;
    },
  });
  expect(asked).toEqual(["Some Font/true"]);
  expect(new TextDecoder("latin1").decode(out)).toContain("LiberationSans-Bold");
});

test("refuses a page count that doesn't match", async () => {
  const src = await PDFDocument.create();
  src.addPage();
  const bytes = await src.save();
  await expect(drawOnPdf(bytes, { pages: [], watermark: null, pageNumbers: null, flattenForms: false, fonts })).rejects.toThrow("mismatch");
});

test("flattens filled form fields into page content", async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([612, 792]);
  const form = src.getForm();
  const name = form.createTextField("name");
  name.setText("Siti Rahma");
  name.addToPage(page, { x: 72, y: 600, width: 200, height: 24 });
  const agree = form.createCheckBox("agree");
  agree.check();
  agree.addToPage(page, { x: 72, y: 560, width: 16, height: 16 });
  const bytes = await src.save();

  const out = await drawOnPdf(bytes, { pages: [{ overlays: [], rotation: 0 }], watermark: null, pageNumbers: null, flattenForms: true, fonts });
  const doc = await PDFDocument.load(out);
  expect(doc.getForm().getFields()).toHaveLength(0);
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots")) as PDFArray | undefined;
  expect(annots?.size() ?? 0).toBe(0);
  // The typed value is now drawn on the page through a form XObject.
  const xobjects = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  expect(xobjects?.keys().length).toBeGreaterThan(0);
});

test("ships Liberation Sans 2 under the SIL Open Font License", () => {
  for (const style of ["Regular", "Bold", "Italic", "BoldItalic"]) {
    const font = fontkit.create(readFileSync(`${fontDir}LiberationSans-${style}.ttf`)) as { familyName: string; version: string };
    expect(font.familyName).toBe("Liberation Sans");
    expect(font.version).toMatch(/^Version 2\./);
  }
  expect(readFileSync(fontDir + "LICENSE", "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
});

test("added text embeds Liberation Sans 2 with Helvetica metrics and stays extractable", async () => {
  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  const text = "Halo dunia, The quick brown fox 0123456789";
  const out = await drawOnPdf(await src.save(), {
    pages: [{ overlays: [{ id: "t", page: "p1", kind: "text", x: 72, y: 72, w: 400, text, size: 12, color: "#000000", rot: 0 }], rotation: 0 }],
    watermark: null,
    pageNumbers: null,
    flattenForms: false,
    fonts,
  });

  // Same advance widths as Helvetica for printable ASCII, so text laid out on screen fits on paper.
  const doc = await PDFDocument.load(out);
  doc.registerFontkit(fontkit);
  const { regular, bold } = await fonts();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
  for (const [ttf, std] of [[await doc.embedFont(regular), helvetica], [await doc.embedFont(bold), helveticaBold]] as const) {
    for (const ch of ascii) expect(ttf.widthOfTextAtSize(ch, 1000)).toBeCloseTo(std.widthOfTextAtSize(ch, 1000), 0);
  }

  // pdf.js reads the text back through the embedded font's ToUnicode map.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: out, useSystemFonts: false });
  const content = await (await (await task.promise).getPage(1)).getTextContent();
  expect(content.items.map((i) => ("str" in i ? i.str : "")).join("")).toContain(text);
  await task.destroy();
});
