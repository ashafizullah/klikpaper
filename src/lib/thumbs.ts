// Page thumbnails, rendered small and cached as object URLs. Renders run one
// at a time so scrolling a long document doesn't flood pdf.js.
import type { Doc, PageItem } from "./doc.svelte";
import { renderToBlob } from "./pdfjs";

const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

export const THUMB_WIDTH = 132;

export function thumbnail(doc: Doc, p: PageItem): Promise<string> {
  const rotation = doc.rotation(p);
  const key = `${doc.id}:${p.source}:${p.index}:${rotation}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = queue.then(async () => {
      const page = await doc.pdfPage(p);
      const wide = rotation % 180 === 0 ? p.w : p.h;
      const blob = await renderToBlob(page, (THUMB_WIDTH * 2) / wide, rotation, "image/jpeg", 0.8);
      return URL.createObjectURL(blob);
    });
    queue = hit.catch(() => {});
    cache.set(key, hit);
  }
  return hit;
}

/** Frees the thumbnails of a closed document. */
export function dropThumbnails(doc: Doc) {
  for (const [key, url] of cache) {
    if (key.startsWith(`${doc.id}:`)) {
      url.then(URL.revokeObjectURL).catch(() => {});
      cache.delete(key);
    }
  }
}
