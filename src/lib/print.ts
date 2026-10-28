// Printing: the document as it looks now (unsaved edits and redactions
// included) is drawn into page pictures, which the system print dialog prints.
// On screen they stay hidden; the print style sheet shows only them.
import type { Doc } from "./doc.svelte";
import { t } from "./i18n/index.svelte";
import { errorText, ipc } from "./ipc";
import { closePdf, openPdf, renderToBlob } from "./pdfjs";
import { snapshotFile } from "./save.svelte";
import { toast, ui } from "./ui.svelte";

const DPI = 200;
/** Picture URLs of the last print; they stay alive while the print dialog may still read them. */
let shown: string[] = [];

function printRoot(): HTMLElement {
  let el = document.getElementById("print-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "print-root";
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
  }
  return el;
}

export async function printDoc(doc: Doc) {
  if (ui.busy) return;
  ui.busy = t("print.preparing");
  let file: string | null = null;
  const urls: string[] = [];
  try {
    file = await snapshotFile(doc);
    const pdf = await openPdf(await ipc.readFile(file));
    const sheets: HTMLElement[] = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        ui.busy = t("print.progress", { i: n, n: pdf.numPages });
        const page = await pdf.getPage(n);
        const [x0, y0, x1, y1] = page.view;
        // Large pages stay under ~24 megapixels.
        const scale = Math.min(DPI / 72, Math.sqrt(24e6 / Math.max(1, (x1 - x0) * (y1 - y0))));
        const blob = await renderToBlob(page, scale, page.rotate, "image/jpeg", 0.92);
        page.cleanup();
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = new Image();
        img.src = url;
        img.alt = "";
        await img.decode().catch(() => {});
        const sheet = document.createElement("div");
        sheet.className = "print-page";
        sheet.append(img);
        sheets.push(sheet);
      }
    } finally {
      closePdf(pdf);
    }
    printRoot().replaceChildren(...sheets);
    for (const u of shown) URL.revokeObjectURL(u);
    shown = urls;
  } catch (e) {
    for (const u of urls) URL.revokeObjectURL(u);
    toast(errorText(e), "error");
    return;
  } finally {
    ui.busy = null;
    if (file) ipc.discardTemp(file).catch(() => {});
  }
  await ipc.printWindow().catch((e) => toast(errorText(e), "error"));
}
