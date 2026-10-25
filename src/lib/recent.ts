// First-page previews for the recent files on the start screen. Rendered one at
// a time, small, and kept for the session; protected or unreadable files just
// show a blank sheet.
import { ipc, type FileStat } from "./ipc";
import { closePdf, openPdf, renderToBlob } from "./pdfjs";

const MAX_BYTES = 60 * 1024 * 1024;
const WIDTH = 220;
const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

export function recentPreview(stat: FileStat): Promise<string | null> {
  const key = `${stat.path}:${stat.bytes}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = queue.then(async () => {
      if (!stat.exists || stat.bytes > MAX_BYTES) return null;
      try {
        const pdf = await openPdf(await ipc.readFile(stat.path));
        try {
          const page = await pdf.getPage(1);
          const { width } = page.getViewport({ scale: 1 });
          const blob = await renderToBlob(page, (WIDTH * 2) / Math.max(1, width), page.rotate, "image/jpeg", 0.8);
          return URL.createObjectURL(blob);
        } finally {
          closePdf(pdf);
        }
      } catch {
        return null;
      }
    });
    queue = hit.catch(() => {});
    cache.set(key, hit);
  }
  return hit;
}
