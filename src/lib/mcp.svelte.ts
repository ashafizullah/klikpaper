// Local MCP server so the user's own Claude Code can work with KlikPaper.
// The server (Rust) only listens on 127.0.0.1 and needs a secret token; tool
// calls are answered here with the same tools as the built-in chat.
import { ipc, type McpInfo } from "./ipc";
import { persist, settings } from "./settings.svelte";
import { runTool, toolsFor } from "./tools.svelte";

export const mcp = $state({ info: null as McpInfo | null, error: null as string | null });

const INSTRUCTIONS = [
  "KlikPaper is a PDF app running on the user's computer.",
  "Tools that take `doc` act on documents open in the app: edits show up live, can be undone by the user, and are written to disk only by save_document.",
  "File tools (merge_pdfs, split_pdf, compress_pdf, ...) read and write PDF files directly; they never overwrite an existing file unless you pass overwrite: true. Use absolute paths.",
  "Page numbers are 1-based. Positions for add_text are points from the top-left of the page as displayed.",
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

/** The one-time command that registers KlikPaper with Claude Code. */
export function addCommand(info: McpInfo): string {
  return `claude mcp add --transport http --scope user klikpaper ${info.url} --header "Authorization: Bearer ${info.token}"`;
}
