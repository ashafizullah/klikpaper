// Fonts installed on this computer, for text boxes. The screen shows each face
// from the same bytes the saved PDF embeds, so text looks and wraps the same.
import { ipc, type SystemFont } from "./ipc";

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
