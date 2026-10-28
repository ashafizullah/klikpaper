// Personal data for agents: find it, and mark it for black out, like
// "Black out personal data" in the app.
import { markPersonal, scanPersonal } from "../personal";
import { PII_KINDS, type PiiKind } from "../pii";
import { DOC, PAGES, obj, str, findDoc, pageIds, type Args, type ToolSpec } from "./args";

const KINDS = {
  type: "array",
  items: { type: "string", enum: PII_KINDS },
  description: "Which kinds: nik (Indonesian ID number), npwp (tax number), phone (mobile number), email, account (bank account or card number), birthdate. Default all.",
};

function chosen(args: Args): PiiKind[] {
  const list = Array.isArray(args.kinds) ? args.kinds.map(String).filter((k): k is PiiKind => (PII_KINDS as string[]).includes(k)) : [];
  return list.length ? list : PII_KINDS;
}

async function scan(args: Args) {
  const doc = findDoc(args);
  const positions = args.pages ? pageIds(doc, str(args, "pages")).map((id) => doc.pages.findIndex((p) => p.id === id)) : undefined;
  return { doc, ...(await scanPersonal(doc, chosen(args), positions)) };
}

const NOTE =
  "Numbers are checked (a NIK's province and birth date, a card's check digit); account numbers and birth dates are only taken next to a word saying what they are. Scanned pages need recognize_text first. Automatic search can miss things, so the user should still look through the pages.";

export const PERSONAL_TOOLS: ToolSpec[] = [
  {
    name: "find_personal_data",
    description: `Lists personal data in a document: Indonesian ID numbers (NIK), tax numbers (NPWP), mobile numbers, email addresses, bank account and card numbers, dates of birth. ${NOTE}`,
    parameters: obj({ doc: DOC, kinds: KINDS, pages: PAGES }),
    scope: "both",
    async run(args) {
      const { finds, scans } = await scan(args);
      return { found: finds.map((f) => ({ kind: f.kind, value: f.value, page: f.page + 1 })), pagesWithoutText: scans };
    },
  },
  {
    name: "redact_personal_data",
    description: `Finds personal data (as find_personal_data) and marks every occurrence for black out. Nothing is removed until the user saves; the marks can be checked and undone. ${NOTE}`,
    parameters: obj({ doc: DOC, kinds: KINDS, pages: PAGES }),
    scope: "both",
    async run(args) {
      const { doc, finds, scans } = await scan(args);
      if (!finds.length) return { marked: 0, pagesWithoutText: scans };
      const boxes = await markPersonal(doc, finds);
      return { marked: finds.length, boxes, kinds: [...new Set(finds.map((f) => f.kind))], pagesWithoutText: scans };
    },
  },
];
