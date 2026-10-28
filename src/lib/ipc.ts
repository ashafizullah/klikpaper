// Typed wrappers over the Rust commands.
import { Channel, invoke } from "@tauri-apps/api/core";

export type Role = "user" | "assistant";
export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "toolCall"; id: string; name: string; input: Record<string, unknown>; meta?: unknown }
  | { type: "toolResult"; id: string; name: string; content: string; isError?: boolean }
  | { type: "opaque"; provider: string; block: unknown };
export interface Message {
  role: Role;
  content: Part[];
}
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ChatRequest {
  format: string;
  profileId: string;
  model: string;
  baseUrl?: string | null;
  system?: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}
export interface ChatResult {
  message: Message;
  stopReason: string;
}

export interface SourceSpec {
  id: string;
  path: string;
  password?: string | null;
}
export interface PageSpec {
  source: string;
  /** 0-based page index in the source. */
  index: number;
  /** Clockwise degrees added to the page's own rotation. */
  rotate: number;
  /** Another paper size to fit the page onto (points, unrotated). */
  sheet?: { w: number; h: number; margin: number } | null;
  /** The page's comment threads, replacing the ones in the file; null leaves them as they are. */
  comments?: CommentThread[] | null;
  /** Areas whose content is removed for good and painted black (page space). */
  redact?: { x: number; y: number; w: number; h: number }[];
  /** A JPEG of the page, already redacted, replacing its content (when it couldn't be redacted piece by piece). */
  raster?: string | null;
  /** Recognized text (a text-only PDF from Tesseract) laid invisibly over the page; `rotation` is how the page was shown when read. */
  ocr?: { path: string; rotation: number } | null;
}

/** A bookmark as written into the file. */
export interface BookmarkSpec {
  title: string;
  /** 0-based position of the page in the output; null for a heading or web link. */
  page: number | null;
  /** Points from the page's top (unrotated); null shows the whole page. */
  y: number | null;
  url: string | null;
  bold: boolean;
  italic: boolean;
  color: [number, number, number] | null;
  open: boolean;
  children: BookmarkSpec[];
}

export interface CommentReply {
  id: string;
  author: string;
  /** ISO 8601; empty when unknown. */
  date: string;
  text: string;
}

export interface CommentThread extends CommentReply {
  /** Points from the page's top-left corner (unrotated, y down). */
  x: number;
  y: number;
  replies: CommentReply[];
  resolved: boolean;
}
export type CompressLevel = "low" | "medium" | "high";
/** A preset, or a custom quality from 10 (smallest file) to 100 (best quality). */
export type Compression = CompressLevel | number;
export interface AssembleOptions {
  stripMetadata?: boolean;
  compress?: Compression | null;
  protect?: { userPassword: string; ownerPassword?: string | null } | null;
  /** Changes to printed content in this save, added to the file's edit history (pages are 1-based). */
  edits?: { textLines: number; textPages: number[]; covers: number; coverPages: number[] } | null;
}
export interface AssembleJob {
  sources: SourceSpec[];
  pages: PageSpec[];
  output: string;
  options?: AssembleOptions;
  /** Bookmarks replacing the file's outline; null keeps the first file's. */
  outline?: BookmarkSpec[] | null;
}
export interface AssembleResult {
  pages: number;
  bytes: number;
  images: number;
  /** Areas redacted. */
  redacted: number;
  /** Redacted pages (0-based positions) to save again as pictures. */
  rasterNeeded: number[];
}
export interface PdfInfo {
  pages: number;
  bytes: number;
  version: string;
  needsPassword: boolean;
  encrypted: boolean;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  created: string | null;
  modified: string | null;
  /** The note left when part of the file was blacked out (redacted). */
  redacted: string | null;
  /** Changes KlikPaper made to the printed content, one line per save. */
  history: string | null;
}
/** A certificate as people read it. */
export interface CertInfo {
  name: string;
  organization: string | null;
  issuer: string;
  issuerOrganization: string | null;
  validFrom: string;
  validTo: string;
  /** Issued by itself: anyone can make one in any name. */
  selfSigned: boolean;
}
/** One digital signature in a file, checked (see signatures.rs). */
export interface SignatureReport {
  field: string | null;
  /** 0-based page of its field. */
  page: number | null;
  timestamp: boolean;
  subFilter: string | null;
  name: string | null;
  reason: string | null;
  location: string | null;
  contact: string | null;
  signedAt: string | null;
  signer: CertInfo | null;
  chain: string[];
  status: "valid" | "invalid" | "unknown";
  intact: boolean | null;
  verified: boolean | null;
  /** Nothing was added to the file after this signature. */
  coversAll: boolean;
  certValidWhenSigned: boolean | null;
  problem: string | null;
}
export type PageSize = "fit" | "a4" | "letter";
export type Orientation = "auto" | "portrait" | "landscape";
export interface ImagesJob {
  images: string[];
  output: string;
  pageSize: PageSize;
  orientation: Orientation;
  margin: number;
}
export interface FileStat {
  path: string;
  exists: boolean;
  bytes: number;
  /** Last change, in milliseconds since 1970 (0 when unknown). */
  modified: number;
}
/** A right-click action from Explorer or Finder: merge, compress, images or to-pdf. */
export interface ShellAction {
  action: string;
  paths: string[];
}
/** A newer version: its number, the running one, and its release notes (Markdown, English). */
export interface Release {
  version: string;
  current: string;
  notes: string;
}
export type UpdateCheck = ({ status: "available" } & Release) | { status: "upToDate"; current: string } | { status: "busy" };
export interface SystemFont {
  family: string;
  /** Has an upright bold face. */
  bold: boolean;
}
export interface McpCall {
  id: number;
  name: string;
  arguments: Record<string, unknown>;
}
export interface McpInfo {
  url: string;
  token: string;
}
export interface McpLink {
  running: boolean;
  connected: boolean;
  client: string | null;
  idleSecs: number | null;
}

type AiStreamEvent = { type: "textDelta"; text: string };
/** Terminal output arrives base64-encoded. */
export type TerminalEvent = { type: "data"; data: string } | { type: "exit"; code: number | null };

export const ipc = {
  readFile: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
  writeFile: (path: string, bytes: Uint8Array) =>
    invoke<void>("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } }),
  fileStats: (paths: string[]) => invoke<FileStat[]>("file_stats", { paths }),
  tempFile: (ext: "pdf" | "png" | "jpg") => invoke<string>("temp_file", { ext }),
  moveFile: (from: string, to: string) => invoke<void>("move_file", { from, to }),
  discardTemp: (path: string) => invoke<void>("discard_temp", { path }),
  takeOpenedFiles: () => invoke<string[]>("take_opened_files"),
  takeShellActions: () => invoke<ShellAction[]>("take_shell_actions"),
  shellMenu: () => invoke<boolean | null>("shell_menu"),
  setShellMenu: (enabled: boolean, labels: { merge: string; compress: string; images: string; toPdf: string }) =>
    invoke<void>("set_shell_menu", { enabled, labels }),
  pdfInfo: (path: string, password?: string | null) => invoke<PdfInfo>("pdf_info", { path, password: password ?? null }),
  pdfSignatures: (path: string, password?: string | null) => invoke<SignatureReport[]>("pdf_signatures", { path, password: password ?? null }),
  pdfComments: (path: string, password?: string | null) => invoke<{ index: number; threads: CommentThread[] }[]>("pdf_comments", { path, password: password ?? null }),
  userName: () => invoke<string>("user_name"),
  assemble: (job: AssembleJob) => invoke<AssembleResult>("pdf_assemble", { job }),
  printWindow: () => invoke<void>("print_window"),
  imagesToPdf: (job: ImagesJob) => invoke<{ pages: number; bytes: number }>("images_to_pdf", { job }),
  keysStatus: (profileIds: string[]) => invoke<Record<string, boolean>>("api_keys_status", { profileIds }),
  setKey: (profileId: string, key: string) => invoke<void>("api_key_set", { profileId, key }),
  deleteKey: (profileId: string) => invoke<void>("api_key_delete", { profileId }),
  chat: (request: ChatRequest, onText?: (t: string) => void) => {
    const ch = new Channel<AiStreamEvent>();
    ch.onmessage = (e) => onText?.(e.text);
    return invoke<ChatResult>("ai_chat", { request, onEvent: ch });
  },
  mcpStart: (tools: unknown, instructions: string, onCall: (c: McpCall) => void) => {
    const ch = new Channel<McpCall>();
    ch.onmessage = onCall;
    return invoke<McpInfo>("mcp_start", { tools, instructions, onCall: ch });
  },
  mcpStop: () => invoke<void>("mcp_stop"),
  mcpLink: () => invoke<McpLink>("mcp_link"),
  mcpReply: (id: number, result: unknown) => invoke<void>("mcp_reply", { id, result }),
  systemFonts: () => invoke<SystemFont[]>("system_fonts"),
  fontFace: async (family: string, bold: boolean) => new Uint8Array(await invoke<ArrayBuffer>("font_face", { family, bold })),
  terminalOpen: (cwd: string, cols: number, rows: number, onEvent: (e: TerminalEvent) => void) => {
    const ch = new Channel<TerminalEvent>();
    ch.onmessage = onEvent;
    return invoke<string>("terminal_open", { cwd, cols, rows, onEvent: ch });
  },
  terminalWrite: (id: string, data: string) => invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows }),
  terminalClose: (id: string) => invoke<void>("terminal_close", { id }),
  checkUpdates: () => invoke<UpdateCheck>("check_updates"),
  installAvailableUpdate: () => invoke<void>("install_available_update"),
  updateChangelog: (version: string, locale: string) => invoke<string>("update_changelog", { version, locale }),
  setMenuLocale: (locale: string) => invoke<void>("set_menu_locale", { locale }),
  setUpdateMode: (mode: string) => invoke<void>("set_update_mode", { mode }),
  pendingUpdate: () => invoke<Release | null>("pending_update"),
  devAutostartMcp: () => invoke<boolean>("dev_autostart_mcp"),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
