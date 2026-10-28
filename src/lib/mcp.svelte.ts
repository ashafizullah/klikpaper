// Local MCP server so the user's own coding agent (Claude Code, Codex, Gemini
// CLI, Cursor, VS Code...) can work with KlikPaper.
// The server (Rust) only listens on 127.0.0.1 and needs a secret token; tool
// calls are answered here with the same tools as the built-in chat.
import { ipc, type McpInfo } from "./ipc";
import { persist, settings } from "./settings.svelte";
import { runTool, toolsFor } from "./tools";

export const mcp = $state({ info: null as McpInfo | null, error: null as string | null });

const INSTRUCTIONS = [
  "KlikPaper is a PDF app running on the user's computer.",
  "Tools that take `doc` act on documents open in the app: edits show up live, can be undone by the user, and are written to disk only by save_document.",
  "File tools (merge_pdfs, split_pdf, compress_pdf, ...) read and write PDF files directly; they never overwrite an existing file unless you pass overwrite: true. Use absolute paths.",
  "Page numbers are 1-based. Positions for add_text, add_shape and add_image are points from the top-left of the page as displayed (document_info gives page sizes).",
  "Annotations (text boxes, highlights, shapes, images) stay editable until the document is saved; the add_* tools return ids that remove_annotations takes. To mark a phrase, use highlight_text rather than guessing coordinates; to change printed words, use replace_text. Scanned pages have no text until recognize_text reads them. To hide private information for good, use redact_text, redact_area or redact_personal_data (find_personal_data lists it first): saving removes the content under the marks from the file, while white-out boxes and replace_text only cover it.",
  "Saving a digitally signed document rewrites it, so its signatures stop being valid: check_signatures first, and save signed documents to a new path. Changes to printed text and blacked-out areas are noted in the file's edit history (document_info shows it).",
  "For many files at once (clean up scans, OCR, black out personal data, watermark, page numbers, compress, password, remove metadata, signature report), use process_files: it writes new files to an output folder and never changes the originals.",
  "To see what changed between two versions of a document, use compare_pdfs. For tilted or dark-edged scans, clean_scans straightens them and can make them black and white (smaller files) before recognize_text.",
].join("\n");

export async function startMcp() {
  const tools = toolsFor("mcp").map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
  try {
    mcp.info = await ipc.mcpStart(tools, INSTRUCTIONS, async (call) => {
      try {
        const text = await runTool(call.name, call.arguments, "mcp");
        await ipc.mcpReply(call.id, { content: [{ type: "text", text }] });
      } catch (e) {
        await ipc.mcpReply(call.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    });
    mcp.error = null;
    settings.mcpEnabled = true;
  } catch (e) {
    mcp.error = e instanceof Error ? e.message : String(e);
    settings.mcpEnabled = false;
  }
  persist();
}

export async function stopMcp() {
  await ipc.mcpStop();
  mcp.info = null;
  settings.mcpEnabled = false;
  persist();
}

/** Agents with ready-made setup steps; "other" shows the raw URL and header. */
export const MCP_CLIENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "other", label: "Other" },
] as const;
export type McpClientId = (typeof MCP_CLIENTS)[number]["id"];

/** The one-time command or config snippet that registers KlikPaper with an agent. */
export function setupSnippet(client: McpClientId, info: McpInfo): string {
  const auth = `Bearer ${info.token}`;
  const headers = { Authorization: auth };
  switch (client) {
    case "claude":
      return `claude mcp add --transport http --scope user klikpaper ${info.url} --header "Authorization: ${auth}"`;
    case "codex":
      return `[mcp_servers.klikpaper]\nurl = "${info.url}"\nhttp_headers = { "Authorization" = "${auth}" }`;
    case "gemini":
      return `gemini mcp add --transport http --scope user klikpaper ${info.url} --header "Authorization: ${auth}"`;
    case "vscode":
      return `code --add-mcp '${JSON.stringify({ name: "klikpaper", type: "http", url: info.url, headers })}'`;
    case "cursor":
      return JSON.stringify({ mcpServers: { klikpaper: { url: info.url, headers } } }, null, 2);
    case "other":
      return `URL: ${info.url}\nAuthorization: ${auth}`;
  }
}

/** The command that starts the agent in a terminal; null when it isn't a terminal app. */
export function agentCommand(client: string): string | null {
  return client === "claude" || client === "codex" || client === "gemini" ? client : null;
}

/** A readable name for the `clientInfo` an agent sent, e.g. "codex-mcp-client 0.50.0" → "Codex". */
export function clientName(client: string | null | undefined): string {
  const known: [RegExp, string][] = [
    [/claude/i, "Claude Code"],
    [/codex/i, "Codex"],
    [/gemini/i, "Gemini CLI"],
    [/cursor/i, "Cursor"],
    [/visual studio code|vscode|copilot/i, "VS Code"],
    [/windsurf|codeium/i, "Windsurf"],
  ];
  if (!client) return "MCP";
  return known.find(([re]) => re.test(client))?.[1] ?? client.split(" ")[0];
}
