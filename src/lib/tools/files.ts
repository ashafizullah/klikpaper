// Tools that read and write PDF files directly: merge, split, extract, compress,
// protect, unlock, strip metadata, convert to and from images, export. They never
// overwrite an existing file unless asked to.
import { exportImages } from "../export";
import { ipc, type CompressLevel, type Compression, type PageSize } from "../ipc";
import { baseName, formatPages, joinPath, parsePages, splitGroups, stripExt } from "../pagespec";
import { PASSWORD_HINT, passwordFits, writePdf } from "../save.svelte";
import { DOC, PAGES, obj, str, secret, num, findDoc, requirePdf, checkOutput, pageCount, type ToolSpec } from "./args";

export const FILE_TOOLS: ToolSpec[] = [
  {
    name: "merge_pdfs",
    description: "Combines PDF files, in the given order, into one new file.",
    parameters: obj({ paths: { type: "array", items: { type: "string" }, minItems: 2 }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["paths", "output"]),
    scope: "mcp",
    async run(args) {
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      if (paths.length < 2) throw new Error("Give at least two files");
      paths.forEach((p) => requirePdf(p, "every path"));
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, paths);
      const sources = paths.map((path, i) => ({ id: `s${i}`, path }));
      const pages = [];
      for (const [i, p] of paths.entries()) {
        const n = await pageCount(p);
        for (let k = 0; k < n; k++) pages.push({ source: `s${i}`, index: k, rotate: 0 });
      }
      const res = await ipc.assemble({ sources, pages, output });
      return `Wrote ${output} (${res.pages} pages)`;
    },
  },
  {
    name: "split_pdf",
    description: 'Splits a PDF file into several files: every N pages, or by ranges separated by semicolons ("1-3; 4-10").',
    parameters: obj({ path: { type: "string" }, every: { type: "integer", minimum: 1 }, ranges: { type: "string" }, output_dir: { type: "string" } }, ["path", "output_dir"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const dir = str(args, "output_dir");
      const total = await pageCount(path);
      const groups = args.ranges ? splitGroups(total, { ranges: str(args, "ranges") }) : splitGroups(total, { every: num(args, "every", 1) });
      if (!groups) throw new Error("Invalid ranges");
      const base = stripExt(baseName(path));
      const width = String(groups.length).length;
      const outputs = groups.map((_, g) => joinPath(dir, `${base}-${String(g + 1).padStart(width, "0")}.pdf`));
      const stats = await ipc.fileStats(outputs);
      const clash = stats.find((s) => s.exists);
      if (clash) throw new Error(`${clash.path} already exists`);
      for (let g = 0; g < groups.length; g++) {
        await ipc.assemble({ sources: [{ id: "s", path }], pages: groups[g].map((n) => ({ source: "s", index: n - 1, rotate: 0 })), output: outputs[g] });
      }
      return { files: outputs };
    },
  },
  {
    name: "extract_pages",
    description: "Copies some pages of a PDF file into a new file.",
    parameters: obj({ path: { type: "string" }, pages: PAGES, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "pages", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const nums = parsePages(str(args, "pages"), await pageCount(path));
      if (!nums) throw new Error("Invalid page list");
      await ipc.assemble({ sources: [{ id: "s", path }], pages: nums.map((n) => ({ source: "s", index: n - 1, rotate: 0 })), output });
      return `Wrote ${output} (pages ${formatPages(nums)})`;
    },
  },
  {
    name: "compress_pdf",
    description: "Makes a PDF smaller by downscaling and re-encoding its photos. low = best quality, high = smallest file; or pass quality (10-100) for a custom setting.",
    parameters: obj(
      {
        path: { type: "string" },
        level: { type: "string", enum: ["low", "medium", "high"] },
        quality: { type: "integer", minimum: 10, maximum: 100, description: "Custom quality instead of level: 90 is about low, 70 medium, 45 high." },
        output: { type: "string" },
        overwrite: { type: "boolean" },
      },
      ["path", "output"],
    ),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const level: Compression =
        args.quality !== undefined
          ? Math.min(100, Math.max(10, Math.round(num(args, "quality"))))
          : ((["low", "medium", "high"].includes(String(args.level)) ? args.level : "medium") as CompressLevel);
      const n = await pageCount(path);
      const before = (await ipc.fileStats([path]))[0].bytes;
      const res = await ipc.assemble({
        sources: [{ id: "s", path }],
        pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })),
        output,
        options: { compress: level },
      });
      return { output, before, after: res.bytes, imagesReencoded: res.images };
    },
  },
  {
    name: "protect_pdf",
    description: "Writes a copy of a PDF that needs a password to open (AES-256). The password must use only letters A-Z without accents, numbers, spaces and keyboard symbols, so every PDF app can open it.",
    parameters: obj({ path: { type: "string" }, password: { type: "string" }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "password", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const password = secret(args, "password");
      if (!passwordFits(password)) throw new Error(`Password not usable: ${PASSWORD_HINT}`);
      const n = await pageCount(path);
      await ipc.assemble({
        sources: [{ id: "s", path }],
        pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })),
        output,
        options: { protect: { userPassword: password } },
      });
      return `Wrote ${output}`;
    },
  },
  {
    name: "unlock_pdf",
    description: "Writes a copy of a password-protected PDF without the password (you must know the password).",
    parameters: obj({ path: { type: "string" }, password: { type: "string" }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "password", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const password = secret(args, "password");
      const n = await pageCount(path, password);
      await ipc.assemble({ sources: [{ id: "s", path, password }], pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })), output });
      return `Wrote ${output}`;
    },
  },
  {
    name: "remove_metadata",
    description: "Writes a copy of a PDF without its document information (title, author, software, dates) and XMP metadata.",
    parameters: obj({ path: { type: "string" }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const n = await pageCount(path);
      await ipc.assemble({
        sources: [{ id: "s", path }],
        pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })),
        output,
        options: { stripMetadata: true },
      });
      return `Wrote ${output}`;
    },
  },
  {
    name: "images_to_pdf",
    description: "Creates a PDF with one image per page (JPEG, PNG, WebP, GIF, BMP, TIFF).",
    parameters: obj(
      {
        images: { type: "array", items: { type: "string" }, minItems: 1 },
        output: { type: "string" },
        page_size: { type: "string", enum: ["a4", "letter", "fit"] },
        margin: { type: "number", description: "Margin in points (default 0)." },
        overwrite: { type: "boolean" },
      },
      ["images", "output"],
    ),
    scope: "mcp",
    async run(args) {
      const images = Array.isArray(args.images) ? args.images.map(String) : [];
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true);
      const pageSize = (["a4", "letter", "fit"].includes(String(args.page_size)) ? args.page_size : "a4") as PageSize;
      const res = await ipc.imagesToPdf({ images, output, pageSize, orientation: "auto", margin: num(args, "margin", 0) });
      return `Wrote ${output} (${res.pages} pages)`;
    },
  },
  {
    name: "pdf_to_images",
    description: "Renders pages of a PDF file to PNG or JPEG images in a folder.",
    parameters: obj(
      { path: { type: "string" }, pages: PAGES, dpi: { type: "integer", minimum: 36, maximum: 600 }, format: { type: "string", enum: ["png", "jpg"] }, output_dir: { type: "string" } },
      ["path", "output_dir"],
    ),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const total = await pageCount(path);
      const nums = args.pages ? parsePages(str(args, "pages"), total) : Array.from({ length: total }, (_, i) => i + 1);
      if (!nums) throw new Error("Invalid page list");
      const format = args.format === "jpg" ? "jpg" : "png";
      const dir = str(args, "output_dir");
      const base = stripExt(baseName(path));
      const width = String(total).length;
      const planned = nums.map((n) => joinPath(dir, `${base}-${String(n).padStart(width, "0")}.${format}`));
      const clash = (await ipc.fileStats(planned)).find((s) => s.exists);
      if (clash) throw new Error(`${clash.path} already exists`);
      const files = await exportImages(path, null, { pages: nums.map((n) => n - 1), dpi: num(args, "dpi", 150), format, dir, base });
      return { files };
    },
  },
  {
    name: "export_document",
    description: "Writes an open document as it looks now (with unsaved edits and annotations) to a new file, optionally only some pages, compressed or password protected. The open document stays as it is.",
    parameters: obj(
      {
        doc: DOC,
        output: { type: "string" },
        pages: PAGES,
        compress: { type: "string", enum: ["low", "medium", "high"] },
        password: { type: "string" },
        overwrite: { type: "boolean" },
      },
      ["output"],
    ),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, doc.path ? [doc.path] : []);
      const nums = args.pages ? parsePages(str(args, "pages"), doc.pages.length) : null;
      if (args.pages && !nums) throw new Error("Invalid page list");
      if (typeof args.password === "string" && !passwordFits(args.password)) throw new Error(`Password not usable: ${PASSWORD_HINT}`);
      const res = await writePdf(doc, output, {
        pages: nums?.map((n) => n - 1),
        compress: (["low", "medium", "high"].includes(String(args.compress)) ? args.compress : null) as CompressLevel | null,
        password: typeof args.password === "string" ? args.password : undefined,
      });
      return { output, pages: res.pages, bytes: res.bytes };
    },
  },
];
