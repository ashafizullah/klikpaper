import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

// pdf.js loads its character maps, standard fonts, color profiles and image
// decoders (JPEG 2000, JBIG2) at runtime, so they are served from public/pdfjs.
// The JavaScript sandbox and the non-WebAssembly fallbacks are left out.
function copyPdfjsAssets() {
  const from = "node_modules/pdfjs-dist";
  for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
    const out = `public/pdfjs/${dir}`;
    if (existsSync(out)) continue;
    mkdirSync(out, { recursive: true });
    for (const f of readdirSync(`${from}/${dir}`)) {
      if (/^quickjs|_nowasm_fallback/.test(f)) continue;
      cpSync(`${from}/${dir}/${f}`, `${out}/${f}`);
    }
  }
}
copyPdfjsAssets();

// The licenses dialog loads the notices on demand instead of bundling half a megabyte of text.
if (existsSync("THIRD_PARTY_NOTICES.md")) cpSync("THIRD_PARTY_NOTICES.md", "public/THIRD_PARTY_NOTICES.md");

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    target: ["safari15", "chrome105"],
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 1422,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1423 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
