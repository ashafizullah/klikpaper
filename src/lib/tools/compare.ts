// Comparing two versions for agents, like "Compare with another version" in the app.
import { changeText, compareVersions, versionFromFile, versionOf, type Version } from "../compare-docs";
import { openDialog } from "../ui.svelte";
import { activate } from "../workspace.svelte";
import { DOC, obj, requirePdf, str, findDoc, type Args, type ToolSpec } from "./args";

/** An open document (by `doc` id, name or path) or a file on disk. */
async function version(args: Args, key: string): Promise<{ v: Version; open: boolean }> {
  const value = str(args, key);
  try {
    return { v: versionOf(findDoc({ doc: value })), open: true };
  } catch {
    requirePdf(value, key);
    return { v: await versionFromFile(value), open: false };
  }
}

export const COMPARE_TOOLS: ToolSpec[] = [
  {
    name: "compare_pdfs",
    description:
      "Compares the text of two versions of a document word by word, across pages: lists what was added, removed or changed, with the page in each version. `before` and `after` are open documents (id, name or path) or absolute paths of PDF files. Pages without text (scans) need recognize_text first; pictures, colors and layout aren't compared. With show: true and `after` an open document, the comparison also opens in the app for the user.",
    parameters: obj({ before: { ...DOC, description: "The older version." }, after: { ...DOC, description: "The newer version." }, show: { type: "boolean" } }, ["before", "after"]),
    scope: "both",
    async run(args) {
      const before = await version(args, "before");
      const after = await version(args, "after");
      try {
        const result = await compareVersions(before.v, after.v);
        if (args.show === true && after.open && !before.open) {
          const doc = findDoc({ doc: str(args, "after") });
          activate(doc);
          openDialog("compare", { doc, against: str(args, "before") });
        }
        if (!result.changes) return { tooDifferent: true, note: "These versions differ too much to compare word by word." };
        const list = result.changes.slice(0, 300).map((c) => {
          const text = changeText(c);
          return { kind: c.kind, pageBefore: c.pageBefore + 1, pageAfter: c.pageAfter + 1, ...(text.before ? { before: text.before } : {}), ...(text.after ? { after: text.after } : {}) };
        });
        return {
          changes: result.changes.length,
          ...(result.changes.length > list.length ? { shown: list.length } : {}),
          pagesWithoutText: { before: result.emptyBefore, after: result.emptyAfter },
          list,
        };
      } finally {
        if (!before.open) before.v.close();
        if (!after.open) after.v.close();
      }
    },
  },
];
