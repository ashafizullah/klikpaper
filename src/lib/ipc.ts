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
}
export type CompressLevel = "low" | "medium" | "high";
export interface AssembleOptions {
  stripMetadata?: boolean;
  compress?: CompressLevel | null;
  protect?: { userPassword: string; ownerPassword?: string | null } | null;
}
export interface AssembleJob {
  sources: SourceSpec[];
  pages: PageSpec[];
  output: string;
  options?: AssembleOptions;
}
export interface AssembleResult {
  pages: number;
  bytes: number;
  images: number;
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

export const ipc = {
  readFile: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
  writeFile: (path: string, bytes: Uint8Array) =>
    invoke<void>("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } }),
  fileStats: (paths: string[]) => invoke<FileStat[]>("file_stats", { paths }),
  tempFile: (ext: "pdf" | "png" | "jpg") => invoke<string>("temp_file", { ext }),
  moveFile: (from: string, to: string) => invoke<void>("move_file", { from, to }),
  discardTemp: (path: string) => invoke<void>("discard_temp", { path }),
  takeOpenedFiles: () => invoke<string[]>("take_opened_files"),
  pdfInfo: (path: string, password?: string | null) => invoke<PdfInfo>("pdf_info", { path, password: password ?? null }),
  assemble: (job: AssembleJob) => invoke<AssembleResult>("pdf_assemble", { job }),
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
  checkUpdates: () => invoke<void>("check_updates"),
  devAutostartMcp: () => invoke<boolean>("dev_autostart_mcp"),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
