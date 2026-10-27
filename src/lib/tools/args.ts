// Shared by the tool modules: argument parsing, finding documents and pages,
// and checks for output files and positions on a page.
import type { Doc, PageItem } from "../doc.svelte";
import { ipc } from "../ipc";
import { baseName, parsePages } from "../pagespec";
import { displayRectToPage, displaySize, displayToPage, type Rect } from "../geometry";
import { activeDoc, ws } from "../workspace.svelte";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** "app": the built-in chat only; "mcp": MCP clients only. */
  scope: "both" | "mcp" | "app";
  run(args: Args): Promise<unknown>;
}

export type Args = Record<string, unknown>;

export const DOC = { type: "string", description: "Document id, file name or path of an open document. Defaults to the active document." };
export const PAGES = { type: "string", description: 'Pages as typed by a person, 1-based: "3", "1-4, 7", "10-" (to the end).' };

export function obj(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

export function str(args: Args, key: string, fallback?: string): string {
  const v = args[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing "${key}"`);
}

export function num(args: Args, key: string, fallback?: number): number {
  const v = typeof args[key] === "string" ? Number(args[key]) : args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing number "${key}"`);
}

export function findDoc(args: Args): Doc {
  const key = typeof args.doc === "string" ? args.doc.trim() : "";
  const doc = key ? ws.docs.find((d) => d.id === key || d.path === key || d.name === key || baseName(d.path ?? "") === key) : activeDoc();
  if (!doc) throw new Error(key ? `No open document matches "${key}"` : "No document is open");
  return doc;
}

/** 1-based page numbers → page ids. */
export function pageIds(doc: Doc, spec: string): string[] {
  const nums = parsePages(spec, doc.pages.length);
  if (!nums) throw new Error(`"${spec}" is not a valid page list for a ${doc.pages.length}-page document`);
  return nums.map((n) => doc.pages[n - 1].id);
}

export function requirePdf(path: string, what = "path") {
  if (!/\.pdf$/i.test(path)) throw new Error(`${what} must be a .pdf file`);
  if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) throw new Error(`${what} must be an absolute path`);
}

export async function checkOutput(output: string, overwrite: boolean, inputs: string[] = []) {
  requirePdf(output, "output");
  if (inputs.includes(output) && !overwrite) throw new Error("output is the same as an input file; pass overwrite: true to replace it");
  const [stat] = await ipc.fileStats([output]);
  if (stat.exists && !overwrite) throw new Error(`${output} already exists; pass overwrite: true to replace it`);
}

export async function pageCount(path: string, password?: string): Promise<number> {
  const info = await ipc.pdfInfo(path, password);
  if (info.needsPassword) throw new Error(password ? `Wrong password for ${baseName(path)}` : `${baseName(path)} needs a password`);
  return info.pages;
}

/** 1-based page number → page, from `args.page`. */
export function pageArg(doc: Doc, args: Args): { n: number; page: PageItem } {
  const n = Math.round(num(args, "page"));
  const page = doc.pages[n - 1];
  if (!page) throw new Error(`Page ${n} does not exist (the document has ${doc.pages.length})`);
  return { n, page };
}

export function color(args: Args, key: string, fallback: string): string;
export function color(args: Args, key: string, fallback: null): string | null;
export function color(args: Args, key: string, fallback: string | null) {
  const v = String(args[key] ?? "");
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

/** A display-space box (as the user sees the page) → page space, refusing boxes off the page. */
export function boxOnPage(doc: Doc, page: PageItem, box: Rect): Rect {
  const rot = doc.rotation(page);
  const [dw, dh] = displaySize(page.w, page.h, rot);
  if (box.w <= 0 || box.h <= 0) throw new Error("width and height must be positive");
  if (box.x < 0 || box.y < 0 || box.x + box.w > dw + 0.5 || box.y + box.h > dh + 0.5)
    throw new Error(`The box is off the page (the page is ${Math.round(dw)}×${Math.round(dh)} pt as displayed)`);
  return displayRectToPage(box, rot, page.w, page.h);
}

export function pointOnPage(doc: Doc, page: PageItem, x: number, y: number): [number, number] {
  const rot = doc.rotation(page);
  const [dw, dh] = displaySize(page.w, page.h, rot);
  if (x < 0 || y < 0 || x > dw + 0.5 || y > dh + 0.5) throw new Error(`(${x}, ${y}) is off the page (the page is ${Math.round(dw)}×${Math.round(dh)} pt as displayed)`);
  return displayToPage(x, y, rot, page.w, page.h);
}
