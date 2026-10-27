# Changelog

## Unreleased

- Resize pages: put pages on A4, Letter, Legal, A3 or A5 paper (from the ⋯ menu or File → Resize Pages). The content is scaled to fit, never stretched, and centered, with an optional margin. You see it right away, Undo takes it back, and Original returns pages to their own size
- AI agents can resize pages too (`resize_pages`)

## 0.1.7

- Edit text: pick the new tool next to Add text and click a line in the PDF to change its words. KlikPaper covers the old line in the page's own color and puts the same words back in a matching font, size and color, ready to edit. The old words stay hidden underneath rather than deleted, so don't use it to hide private information
- AI agents can change printed words too (`replace_text`)

## 0.1.6

- Update messages now appear inside KlikPaper, in your language, and show what's new before you install. After an update, KlikPaper shows you once what changed
- You can check for updates from Settings → About too
- The menu bar is in Bahasa Indonesia when you choose that language
- Recent files on the Home screen can be shown as large tiles or as a compact list
- Compress now tells you when a PDF has no photos to make smaller (such a PDF can't get much smaller)
- When an AI agent highlights text for you, the highlight now covers exactly the right words
- Fixed the font size box going blank for some sizes

## 0.1.5

- A built-in terminal (title bar button or Ctrl+`) to run your agent right next to your PDFs; it opens in the active document's folder and can type the agent's command for you
- Text boxes can use any font installed on your computer (pick it next to the font size); the saved PDF embeds that font, so it looks the same everywhere. Fonts whose license forbids embedding are refused
- Automatic updates: new versions download in the background and install when you quit, or right away with Restart to update. Settings → General lets you switch to asking first or to checking only on request
- Compress shows the resulting file size for every level before you save, and has a Custom quality slider (also `quality` in the `compress_pdf` MCP tool)
- Right-click actions: an option in Settings → General adds Merge, Compress and Convert to images with KlikPaper for PDFs, and Convert to PDF with KlikPaper for images, to the File Explorer right-click menu on Windows (under Show more options on Windows 11) and to Finder's Quick Actions on macOS
- Compress and Export as images are on the toolbar
- The + next to the tabs (or Ctrl/⌘+T, File → New Tab) opens a Home tab instead of going straight to the file picker; opening a file from it takes that tab's place
- Highlights no longer hide the text under them on screen (saved files were already right)
- New MCP and AI chat tools: highlight, underline or strike through a phrase (`highlight_text`), draw shapes, arrows, whiteout and ink (`add_shape`), place an image or saved signature (`add_image`), list and remove annotations, duplicate pages, undo and redo, close a document and list the installed fonts (`list_fonts`); `add_text` takes a font and returns the new text box's id

## 0.1.4

- The MCP server now has setup steps for Codex, Gemini CLI, VS Code and Cursor besides Claude Code, plus the raw URL and header for any other client; the title bar shows which agent is connected

## 0.1.3

- Text added to PDFs now uses Liberation Sans 2 (SIL Open Font License) instead of the GPL-licensed 1.x fonts

## 0.1.2

- Third-party notices now include every license and notice text for packages under more than one license, and a source link for the MPL-2.0 crates
- The app's copyright line now names its author

## 0.1.1

- Third-party notices now carry the full license text for every crate
- Images to PDF now really accepts GIF, BMP and TIFF, as advertised (only JPEG, PNG and WebP were decoded before)
- Credit PDF.js for the text and annotation layer styles adapted from its viewer, and state the Liberation Sans font license correctly in the notices
- README: the undo claim now says what can be undone

## 0.1.0

- First release: view, organize (reorder, rotate, delete, duplicate, insert, merge, split, extract), compress, convert (images ↔ PDF), annotate (highlight, underline, strike-through, text, drawing, shapes, arrows, white-out, images), sign, watermark, page numbers, password protection (AES-256), metadata removal and form filling
- Ask this PDF: chat about the open document with your own Anthropic or OpenAI-compatible API key, with clickable page citations
- Local MCP server so your own Claude Code can work with open documents and PDF files
- English and Bahasa Indonesia
