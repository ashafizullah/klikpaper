<p align="center">
  <img src="design/icon.png" width="128" alt="KlikPaper icon">
</p>

<h1 align="center">KlikPaper</h1>

<p align="center">
  A free, open-source PDF tool for the desktop. View, organize, compress, convert, annotate, sign and protect PDFs on your own computer, and ask questions about them with your own AI key. Small, fast and offline.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ashafizullah/klikpaper?color=blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust" alt="Rust">
  <a href="https://github.com/ashafizullah/klikpaper/actions/workflows/ci.yml"><img src="https://github.com/ashafizullah/klikpaper/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ashafizullah/klikpaper/releases/latest"><img src="https://img.shields.io/github/v/release/ashafizullah/klikpaper?include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/ashafizullah/klikpaper/releases"><img src="https://img.shields.io/github/downloads/ashafizullah/klikpaper/total?color=brightgreen" alt="Downloads"></a>
</p>

<p align="center">
  <a href="https://trakteer.id/adamshafizullah/tip"><img src="https://img.shields.io/badge/Buy%20me%20an%20AI%20token-Trakteer-C02E2E?style=for-the-badge" alt="Buy me an AI token on Trakteer"></a>
</p>

<p align="center">
  Part of <a href="https://klikapps.pages.dev"><b>Klik Apps</b></a>, a family of free, open-source desktop apps: <a href="https://klikapps.pages.dev">klikapps.pages.dev</a>
</p>

<p align="center">
  <img src="design/screenshot.png" width="900" alt="KlikPaper with a highlighted PDF, the page sidebar and the Ask this PDF panel">
</p>


## Features

- **Viewer**: fast continuous scrolling, zoom and fit width, text selection, find in document, clickable links, fillable forms, tabs for several PDFs
- **Organize pages**: drag thumbnails to reorder, rotate, delete, duplicate, insert pages from other PDFs, merge several files, split by ranges or every N pages, save selected pages as a new PDF
- **Compress**: three levels that downscale and re-encode photos; text, vector graphics and fonts are untouched. The dialog shows the new size before you save
- **Convert**: images (JPG, PNG, WebP, GIF, BMP, TIFF) to PDF, and pages to PNG or JPEG
- **Annotate**: highlight, underline and strike through text (saved as real PDF annotations other viewers can list), text boxes, freehand drawing, rectangles, ellipses, arrows, white-out, images
- **Sign**: draw, type or upload a signature, place and resize it. This is a picture of your signature, not a certificate-based digital signature
- **Watermark and page numbers**, previewed live on every page
- **Password and privacy**: open protected PDFs, protect with AES-256, remove a password you know, strip metadata, flatten form fields
- **Ask this PDF** (optional): chat about the open document, with answers that cite pages you can click. Bring your own key for Anthropic (Claude) or any OpenAI-compatible API (OpenAI, OpenRouter, Gemini, Groq, Ollama...). The AI can also rotate, move or delete pages and add text when you ask. Keys are stored in the OS keychain
- **Works with Claude Code**: turn on the local MCP server and your own Claude Code can read, search and edit open PDFs, and merge, split, compress, protect or convert files
- **Undo and redo** for page changes, annotations, watermarks and page numbers; nothing is written to the file until you save
- **English and Bahasa Indonesia** interface; **auto-update** from GitHub Releases (signed packages)

## Privacy

KlikPaper works offline. Your files never leave your computer, with two exceptions you control:

- **Update checks** ask GitHub Releases for a newer version.
- **AI chat**, when you set it up and use it, sends the open document's text and your question to the AI provider you chose, with your own API key. Nothing is sent to KlikPaper or its author.

There is no account, no telemetry and no analytics.

## Download

Get the latest version from **[Releases](https://github.com/ashafizullah/klikpaper/releases/latest)**:

| Platform | File |
|---|---|
| macOS 11+ (Apple Silicon & Intel) | `KlikPaper_x.y.z_universal.dmg` |
| Windows 10/11 (x64) | `KlikPaper_x.y.z_x64-setup.exe` or `.msi` |
| Linux x86_64 | `.deb`, `.rpm` or `.AppImage` |

**macOS:** open the DMG and drag KlikPaper into Applications. KlikPaper is signed and notarized by Apple, so it opens without a Gatekeeper warning. Or use the install script, which downloads the latest DMG, copies KlikPaper into Applications and opens it:

```sh
curl -fsSL https://raw.githubusercontent.com/ashafizullah/klikpaper/main/install.sh | bash
```

**Windows:** SmartScreen may warn about an unsigned app. Click **More info → Run anyway**.

## Using Claude Code

1. Open **Settings → Claude Code** and enable the local MCP server.
2. Copy the `claude mcp add …` command and run it once in a terminal.
3. Start `claude` and ask, for example, *"merge every PDF in ~/Invoices into one file sorted by date"* or *"in the open document, delete the blank pages and add page numbers"*.

The server only listens on `127.0.0.1` and requires a secret token. KlikPaper never starts Claude Code, sends it prompts or touches your Claude credentials. File tools never overwrite an existing file unless asked to, and only write PDF, PNG and JPEG files.

## Requirements

- Nothing for the PDF tools: they work offline
- For **Ask this PDF**: an API key for a chat model (Claude, GPT, Gemini, OpenRouter…), or a local OpenAI-compatible server such as Ollama
- For **Claude Code**: Claude Code installed and signed in on the same computer

## Development

Requires [Bun](https://bun.sh/) and stable Rust. On Linux, also install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

```sh
bun install
bun run tauri dev      # run
bun run tauri build    # bundle
bun run check          # type check
bun run test           # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml
bun run notices        # license check + THIRD_PARTY_NOTICES.md
```

### How it fits together

- `src/` is the Svelte 5 interface. PDF.js renders pages, text and form layers; your edits live in a document model (`src/lib/doc.svelte.ts`) as an ordered list of pages from one or more files plus annotations, with undo history.
- Saving sends the page list to Rust (`src-tauri/src/pdf/`), where lopdf assembles the new file (merge, reorder, rotate, delete), compresses images, strips metadata and encrypts. Annotations, watermarks and page numbers are drawn with pdf-lib (`src/lib/draw.ts`) in between.
- The webview can only read and write PDFs and images (`src-tauri/src/files.rs`). API keys stay in the OS keychain and never reach the webview.

## Contributing

Issues and pull requests are welcome. CI runs type checks, tests, `cargo fmt`, `clippy`, `cargo test` and the license check on macOS, Windows and Linux. Please run them locally before opening a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and guidelines, including the rules on third-party code.

### Releasing

Add a `## x.y.z` section to `CHANGELOG.md`, bump `version` in `tauri.conf.json`, `Cargo.toml` and `package.json`, then push a tag. CI builds the signed and notarized macOS DMG, the Windows installers and the Linux packages, signs the update packages and attaches everything (including `latest.json` for the in-app updater) to a draft release. Publish the draft to roll it out.

Releases need the `TAURI_SIGNING_PRIVATE_KEY` secret (its public key is in `tauri.conf.json`) plus `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` for macOS signing and notarization.

```sh
git tag v0.1.1 && git push origin v0.1.1
```

The Windows installer and DMG artwork in `src-tauri/installer/` is rendered from `design/installer/art.html` with `scripts/installer-art.sh`.

## Support

KlikPaper is free. If it saves you time, **[buy me an AI token on Trakteer](https://trakteer.id/adamshafizullah/tip)** ☕🤖.

## License

[MIT](LICENSE)

KlikPaper is built on [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (MIT) and [lopdf](https://github.com/J-F-Liu/lopdf) (MIT), and bundles other third-party software, including the interface fonts Fraunces, IBM Plex Sans and IBM Plex Mono (SIL Open Font License 1.1). Their licenses are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), which the app also shows under Settings → About → Open-source licenses. Run `bun run notices` after changing dependencies.

Adobe and Acrobat are trademarks of Adobe Inc. Claude and Claude Code are trademarks of Anthropic. KlikPaper is an independent project and is not affiliated with or endorsed by Adobe, Anthropic or Mozilla.
