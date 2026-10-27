// Fonts installed on this computer, for text boxes. The screen shows each face
// from the same bytes the saved PDF embeds, so text looks and wraps the same.
import { ipc, type SystemFont } from "./ipc";
import { FIRST_BASELINE, LINE_HEIGHT } from "./layout";

export const fonts = $state({ list: [] as SystemFont[] });

let listing: Promise<SystemFont[]> | null = null;

/** Lists the installed families once per session. */
export function loadSystemFonts(): Promise<SystemFont[]> {
  listing ??= ipc.systemFonts().then(
    (list) => (fonts.list = list),
    (e) => {
      listing = null;
      throw e;
    },
  );
  return listing;
}

function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = map.get(key);
  if (!hit) {
    hit = load();
    hit.catch(() => map.delete(key));
    map.set(key, hit);
  }
  return hit;
}

const files = new Map<string, Promise<Uint8Array>>();
const shown = new Map<string, Promise<void>>();

/** The file of a family's regular or bold face; rejects when its license forbids embedding. */
export function fontFile(family: string, bold = false): Promise<Uint8Array> {
  return cached(files, `${family}\n${bold}`, () => ipc.fontFace(family, bold));
}

/** CSS name the face is registered under, apart from the system's own copy. */
const cssFamily = (family: string) => `KlikPaper ${family.replace(/["\\]/g, "")}`;

/** Registers the face with the page so text boxes can use it (see fontStack). */
export function showFont(family: string, bold = false): Promise<void> {
  return cached(shown, `${family}\n${bold}`, async () => {
    const face = new FontFace(cssFamily(family), (await fontFile(family, bold)) as Uint8Array<ArrayBuffer>, { weight: bold ? "700" : "400" });
    document.fonts.add(await face.load());
  });
}

/** CSS font-family of a text box: its font, else the default Liberation Sans (Arial metrics). */
export function fontStack(family?: string): string {
  return family ? `"${cssFamily(family)}", var(--page-font)` : "var(--page-font)";
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The installed family closest to a PDF font ("ABCDEF+TimesNewRomanPSMT-Bold" →
 * Times New Roman, bold), else a common one of the same kind for serif and
 * monospace text. Sans-serif text without a match keeps the default font, which
 * has Arial's and Helvetica's letter widths. Only embeddable fonts are offered.
 */
export async function matchFont(pdfFont: string, generic: string, boldHint = false): Promise<{ family?: string; bold: boolean }> {
  const name = pdfFont.replace(/^[A-Z]{6}\+/, "");
  const [base = "", style = ""] = name.split(/[-,]/);
  const bold = boldHint || /bold|black|heavy|semibold|demi/i.test(style) || /(bold|black|heavy)$/i.test(base);
  const list = await loadSystemFonts().catch(() => [] as SystemFont[]);
  const key = squash(base).replace(/(psmt|mt|ps|bold|black|heavy)+$/, "");
  const prefer =
    generic === "serif"
      ? ["Times New Roman", "Georgia", "Liberation Serif", "Times"]
      : generic === "monospace"
        ? ["Courier New", "Menlo", "Consolas", "Liberation Mono", "Courier"]
        : [];
  const candidates = [
    key && list.find((f) => squash(f.family) === key)?.family,
    key.length > 3 && list.find((f) => squash(f.family).startsWith(key) || key.startsWith(squash(f.family)))?.family,
    ...prefer.map((p) => list.find((f) => f.family === p)?.family),
  ].filter((f): f is string => !!f);
  for (const family of candidates) {
    try {
      await showFont(family, bold);
      return { family, bold };
    } catch {}
  }
  return { bold };
}

/** Where the first line's baseline sits below a text box's top, as a share of the font size (as the page lays it out). */
export function baselineShare(family: string | undefined, bold = false): number {
  if (!family) return FIRST_BASELINE;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return FIRST_BASELINE;
  ctx.font = `${bold ? 700 : 400} 100px "${cssFamily(family)}"`;
  const m = ctx.measureText("Hg");
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (!ascent) return FIRST_BASELINE;
  return (LINE_HEIGHT * 100 - (ascent + descent)) / 2 / 100 + ascent / 100;
}
