// Actions the AI chat and external agents (over MCP) can take. One registry so both
// behave the same. Changes to open documents are ordinary edits: they show up
// live and can be undone. File tools never overwrite an existing file unless
// asked to, and only write PDF/PNG/JPEG files (the backend enforces this too).
import { errorText } from "../ipc";
import type { Args, ToolSpec } from "./args";
import { ANNOTATION_TOOLS } from "./annotations";
import { DOCUMENT_TOOLS } from "./documents";
import { FILE_TOOLS } from "./files";

export type { ToolSpec };

export const TOOLS: ToolSpec[] = [...DOCUMENT_TOOLS, ...ANNOTATION_TOOLS, ...FILE_TOOLS];

export function toolsFor(scope: "app" | "mcp"): ToolSpec[] {
  return TOOLS.filter((t) => t.scope === "both" || t.scope === scope);
}

export async function runTool(name: string, args: Args, scope: "app" | "mcp"): Promise<string> {
  const tool = toolsFor(scope).find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  try {
    const out = await tool.run(args ?? {});
    return typeof out === "string" ? out : JSON.stringify(out, null, 2);
  } catch (e) {
    throw new Error(errorText(e));
  }
}
