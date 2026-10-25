// Writes KlikPaper's annotations into a PDF with pdf-lib. Highlights,
// underlines and strike-throughs become real PDF annotations (other viewers can
// list and remove them); text, shapes, drawings, images and signatures become
// part of the page.
import { PDFDocument, PDFName, PDFString, LineCapStyle, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";
import type { Overlay, PageNumbers, Watermark } from "./doc.svelte";
import { displaySize, displayToPage, rotateOffset, type Rotation } from "./geometry";
import { arrowHead, FIRST_BASELINE, LINE_HEIGHT, numberAnchor, pageLabel, wrapLines } from "./layout";

export { arrowHead, numberAnchor, pageLabel, wrapLines };

export interface DrawPage {
  overlays: Overlay[];
  rotation: Rotation;
}

export interface DrawJob {
  pages: DrawPage[];
  watermark: Watermark | null;
  pageNumbers: PageNumbers | null;
  flattenForms: boolean;
  /** TrueType fonts for text (Liberation Sans, metric-compatible with Arial/Helvetica). */
  fonts: () => Promise<{ regular: Uint8Array; bold: Uint8Array }>;
}

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function rgbArray(hex: string): number[] {
  const c = hexToRgb(hex) as unknown as { red: number; green: number; blue: number };
  return [c.red, c.green, c.blue];
}

/** Splits text into lines that fit `width`, breaking at spaces (or inside very long words). */
function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, data] = src.split(",", 2);
  const bin = atob(data ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: !/jpe?g/i.test(head) };
}

export async function drawOnPdf(input: Uint8Array, job: DrawJob): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input, { updateMetadata: false });
  pdf.registerFontkit(fontkit);
  let fonts: { regular: PDFFont; bold: PDFFont } | null = null;
  const font = async (bold = false) => {
    if (!fonts) {
      const f = await job.fonts();
      fonts = { regular: await pdf.embedFont(f.regular, { subset: true }), bold: await pdf.embedFont(f.bold, { subset: true }) };
    }
    return bold ? fonts.bold : fonts.regular;
  };
  const images = new Map<string, PDFImage>();
  const image = async (src: string) => {
    let img = images.get(src);
    if (!img) {
      const { bytes, png } = dataUrlBytes(src);
      img = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      images.set(src, img);
    }
    return img;
  };

  const pages = pdf.getPages();
  if (pages.length !== job.pages.length) throw new Error(`Page count mismatch (${pages.length} vs ${job.pages.length})`);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const spec = job.pages[i];
    const box = page.getCropBox();
    const w = box.width;
    const h = box.height;
    // Page space (top-left origin, y down) to PDF user space.
    const X = (x: number) => box.x + x;
    const Y = (y: number) => box.y + h - y;

    for (const o of spec.overlays) {
      switch (o.kind) {
        case "text": {
          const f = await font(o.bold);
          const lines = wrapLines(o.text, (s) => f.widthOfTextAtSize(s, o.size), o.w);
          lines.forEach((line, n) => {
            if (!line) return;
            const [dx, dy] = rotateOffset(0, o.size * (FIRST_BASELINE + n * LINE_HEIGHT), o.rot);
            page.drawText(line, { x: X(o.x + dx), y: Y(o.y + dy), size: o.size, font: f, color: hexToRgb(o.color), rotate: degrees(o.rot) });
          });
          break;
        }
        case "image": {
          const img = await image(o.src);
          const [dx, dy] = rotateOffset(0, o.h, o.rot);
          page.drawImage(img, { x: X(o.x + dx), y: Y(o.y + dy), width: o.w, height: o.h, rotate: degrees(o.rot) });
          break;
        }
        case "rect":
          page.drawRectangle({
            x: X(o.x),
            y: Y(o.y + o.h),
            width: o.w,
            height: o.h,
            borderColor: o.width > 0 ? hexToRgb(o.color) : undefined,
            borderWidth: o.width,
            color: o.fill ? hexToRgb(o.fill) : undefined,
          });
          break;
        case "ellipse":
          page.drawEllipse({
            x: X(o.x + o.w / 2),
            y: Y(o.y + o.h / 2),
            xScale: o.w / 2,
            yScale: o.h / 2,
            borderColor: o.width > 0 ? hexToRgb(o.color) : undefined,
            borderWidth: o.width,
            color: o.fill ? hexToRgb(o.fill) : undefined,
          });
          break;
        case "line":
        case "arrow": {
          const color = hexToRgb(o.color);
          const line = (x1: number, y1: number, x2: number, y2: number) =>
            page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: o.width, color, lineCap: LineCapStyle.Round });
          line(o.x1, o.y1, o.x2, o.y2);
          if (o.kind === "arrow") {
            for (const [hx, hy] of arrowHead(o.x1, o.y1, o.x2, o.y2, o.width)) line(o.x2, o.y2, hx, hy);
          }
          break;
        }
        case "ink": {
          if (o.points.length < 4) break;
          let path = `M ${o.points[0]} ${o.points[1]}`;
          for (let p = 2; p < o.points.length; p += 2) path += ` L ${o.points[p]} ${o.points[p + 1]}`;
          page.drawSvgPath(path, { x: X(0), y: Y(0), borderColor: hexToRgb(o.color), borderWidth: o.width, borderLineCap: LineCapStyle.Round });
          break;
        }
        case "markup":
          addMarkup(pdf, page, o, X, Y);
          break;
      }
    }

    if (job.watermark?.text.trim()) {
      const wm = job.watermark;
      const f = await font(true);
      const rot = spec.rotation + wm.angle;
      const tw = f.widthOfTextAtSize(wm.text, wm.size);
      const [dx, dy] = rotateOffset(-tw / 2, wm.size * 0.35, rot);
      page.drawText(wm.text, { x: X(w / 2 + dx), y: Y(h / 2 + dy), size: wm.size, font: f, color: hexToRgb(wm.color), opacity: wm.opacity, rotate: degrees(rot) });
    }

    if (job.pageNumbers) {
      const pn = job.pageNumbers;
      const f = await font();
      const label = pageLabel(pn, i, pages.length);
      const tw = f.widthOfTextAtSize(label, pn.size);
      const [bx, by] = numberAnchor(pn.position, displaySize(w, h, spec.rotation), tw, pn.size, pn.margin);
      const [px, py] = displayToPage(bx, by, spec.rotation, w, h);
      page.drawText(label, { x: X(px), y: Y(py), size: pn.size, font: f, color: hexToRgb(pn.color), rotate: degrees(spec.rotation) });
    }
  }

  if (job.flattenForms) {
    try {
      pdf.getForm().flatten();
    } catch {
      // A form pdf-lib can't flatten keeps its fields rather than failing the save.
    }
  }
  return pdf.save({ useObjectStreams: false });
}

function addMarkup(pdf: PDFDocument, page: PDFPage, o: Extract<Overlay, { kind: "markup" }>, X: (x: number) => number, Y: (y: number) => number) {
  if (!o.rects.length) return;
  const ctx = pdf.context;
  // QuadPoints per rectangle: upper-left, upper-right, lower-left, lower-right (the order viewers expect).
  const quads: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let ops = "";
  const [r, g, b] = rgbArray(o.color);
  for (const rc of o.rects) {
    const x0 = X(rc.x);
    const x1 = X(rc.x + rc.w);
    const top = Y(rc.y);
    const bottom = Y(rc.y + rc.h);
    quads.push(x0, top, x1, top, x0, bottom, x1, bottom);
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, bottom);
    maxY = Math.max(maxY, top);
    const f = (n: number) => n.toFixed(2);
    if (o.style === "highlight") {
      ops += `${f(x0)} ${f(bottom)} ${f(x1 - x0)} ${f(top - bottom)} re f\n`;
    } else {
      const lw = Math.max(0.6, (top - bottom) / 14);
      const y = o.style === "underline" ? bottom + lw : (top + bottom) / 2;
      ops += `${f(lw)} w ${f(x0)} ${f(y)} m ${f(x1)} ${f(y)} l S\n`;
    }
  }
  const rect = [minX, minY, maxX, maxY];
  const gs = ctx.obj({ Type: "ExtGState", BM: o.style === "highlight" ? "Multiply" : "Normal", CA: 1, ca: 1 });
  const color = o.style === "highlight" ? `${r} ${g} ${b} rg` : `${r} ${g} ${b} RG`;
  const appearance = ctx.stream(`q /GS0 gs ${color}\n${ops}Q`, {
    Type: "XObject",
    Subtype: "Form",
    BBox: rect,
    Resources: { ExtGState: { GS0: gs } },
  });
  const subtype = { highlight: "Highlight", underline: "Underline", strike: "StrikeOut" }[o.style];
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: subtype,
    Rect: rect,
    QuadPoints: quads,
    C: [r, g, b],
    F: 4,
    P: page.ref,
    AP: { N: ctx.register(appearance) },
  });
  annot.set(PDFName.of("NM"), PDFString.of(o.id));
  annot.set(PDFName.of("T"), PDFString.of("KlikPaper"));
  page.node.addAnnot(ctx.register(annot));
}
