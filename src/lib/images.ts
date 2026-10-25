// Images placed on pages: picked from disk and normalized to PNG or JPEG data
// URLs (the formats a PDF can embed), with a sensible starting size.
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "./ipc";

export interface PlacedImage {
  src: string;
  /** Natural size in points, limited to a comfortable starting size. */
  width: number;
  height: number;
}

const MAX_START = 220;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Not a supported image"));
    img.src = src;
  });
}

export function fitSize(w: number, h: number, max = MAX_START): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: w * s, height: h * s };
}

/** Re-encodes anything that isn't PNG or JPEG as PNG; downsizes huge photos. */
export async function normalizeImage(bytes: Uint8Array, mime: string): Promise<PlacedImage> {
  const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = await loadImage(blobUrl);
    const maxPx = 2400;
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const keep = (mime === "image/png" || mime === "image/jpeg") && scale === 1;
    let src: string;
    if (keep) {
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      src = `data:${mime};base64,${btoa(bin)}`;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      src = mime === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
    }
    return { src, ...fitSize(img.naturalWidth * 0.75, img.naturalHeight * 0.75) };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };

export async function pickImage(): Promise<PlacedImage | null> {
  const picked = await openFileDialog({ multiple: false, filters: [{ name: "Images", extensions: Object.keys(MIME) }] });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  const ext = path.split(".").pop()!.toLowerCase();
  return normalizeImage(await ipc.readFile(path), MIME[ext] ?? "image/png");
}
