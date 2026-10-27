// Interface state shared across components: the active tool, dialogs, toasts and busy indicator.
import { settings } from "./settings.svelte";

export type Tool =
  | "select"
  | "text"
  | "highlight"
  | "underline"
  | "strike"
  | "ink"
  | "rect"
  | "ellipse"
  | "arrow"
  | "image"
  | "whiteout";

export const DEFAULT_COLORS: Record<string, string> = {
  text: "#1b1916",
  highlight: "#ffd400",
  underline: "#d92d20",
  strike: "#d92d20",
  ink: "#1d4ed8",
  rect: "#d92d20",
  ellipse: "#d92d20",
  arrow: "#d92d20",
};

export const SWATCHES = ["#1b1916", "#d92d20", "#f97316", "#ffd400", "#16a34a", "#1d4ed8", "#7c3aed", "#ffffff"];

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "ok";
  action?: { label: string; run: () => void };
}

export interface DialogState {
  kind: string;
  props: Record<string, unknown>;
  resolve: (value: unknown) => void;
}

/** An image (or signature) waiting to be placed with the next click on a page. */
export interface PendingImage {
  src: string;
  width: number;
  height: number;
}

export const ui = $state({
  tool: "select" as Tool,
  strokeWidth: 2,
  fontSize: 14,
  busy: null as string | null,
  toasts: [] as Toast[],
  dialogs: [] as DialogState[],
  findOpen: false,
  /** The terminal panel; its shell starts the first time it opens. */
  terminal: false,
  /** The search text and the match being shown (index into the page list of the document). */
  findQuery: "",
  findPage: -1,
  pendingImage: null as PendingImage | null,
});

export function toolColor(tool: string): string {
  return settings.colors[tool] ?? DEFAULT_COLORS[tool] ?? "#1b1916";
}

let nextToast = 1;
/** `ms` = 0 keeps the toast until the user closes it or takes its action. */
export function toast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"], ms = kind === "error" ? 9000 : 4500) {
  const id = nextToast++;
  ui.toasts.push({ id, text, kind, action });
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number) {
  ui.toasts = ui.toasts.filter((t) => t.id !== id);
}

export type AlertTone = "info" | "success" | "error" | "update";
export interface AlertAction {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}
export interface AlertOptions {
  title: string;
  message?: string;
  /** Shown below the message, e.g. a changelog; rendered with the safe Markdown subset. */
  markdown?: string;
  tone?: AlertTone;
  /** Buttons in order (the primary one last); just OK when omitted. */
  actions?: AlertAction[];
}

/** The in-app alert (AlertDialog); resolves with the chosen action's value, or null when dismissed. */
export function showAlert(options: AlertOptions): Promise<string | null> {
  return openDialog<string>("alert", { ...options });
}

/** Shows a dialog component (by kind) and resolves with its result, or null when cancelled. */
export function openDialog<T = unknown>(kind: string, props: Record<string, unknown> = {}): Promise<T | null> {
  return new Promise((resolve) => {
    ui.dialogs.push({ kind, props, resolve: resolve as (v: unknown) => void });
  });
}

export function closeDialog(value: unknown = null) {
  const top = ui.dialogs.pop();
  top?.resolve(value);
}

/** Runs `fn` with a busy indicator; errors become toasts. */
export async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  ui.busy = label;
  try {
    return await fn();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  } finally {
    ui.busy = null;
  }
}

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
export const mod = isMac ? "⌘" : "Ctrl+";
