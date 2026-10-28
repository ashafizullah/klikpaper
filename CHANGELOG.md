# Changelog

## Unreleased

- Black out personal data (⋯ menu, or File → Black Out Personal Data): finds Indonesian ID numbers (NIK), tax numbers (NPWP), mobile numbers, email addresses, bank account and card numbers, and dates of birth across the document. Numbers are checked, not just matched (a NIK's region and birth date, a card's check digit), and account numbers and birth dates are only picked up next to a label, so invoice numbers, totals and ordinary dates stay. You review the list and untick anything that isn't private before it's marked
- Check digital signatures: a signed PDF shows a badge (Signed, Changed after signing, or Signature not valid). Click it to see who signed, when, why and where, with which certificate, whether the document changed after signing, and what KlikPaper can't check (whether the certificate's issuer is trusted or the certificate revoked). Saving a signed PDF warns that its signatures won't be valid in the saved file and suggests a new file
- Process many files (Home, or File → Process Many Files): pick files or a folder and recognize text, black out personal data, add a watermark or page numbers, compress, protect with a password or remove metadata on all of them at once, or just report their digital signatures. New files go to a folder you choose, the originals are never changed, and a report shows what happened to each file
- AI agents can find and black out personal data (`find_personal_data`, `redact_personal_data`), check signatures (`check_signatures`), process many files (`process_files`), rename or move bookmarks (`update_bookmark`) and open the print dialog (`print_document`); `document_info` also reports bookmarks, pending black outs, the edit history and signatures
- Fixes: a tooltip no longer stays on screen after its button goes away; the empty Bookmarks panel's button fits the sidebar; the toolbar fits more often in medium-sized windows

## 0.1.14

- Black out (redact): hide private details such as ID or account numbers. Pick the new tool and drag a box over them, right-click selected text, or black out every match of a search at once. When you save, what's under the black boxes is really deleted from the file, not just covered, so nobody can copy it or bring it back; on scanned pages the ink of every word taken out goes too. KlikPaper suggests saving the result as a new file, so you keep the original, and the file notes that parts were blacked out
- Recognize text (OCR): scanned pages become text you can search, select and copy, that the AI can read and that Black out can remove word by word. Find it in the ⋯ menu, File → Recognize Text (OCR), by right-clicking a page, or in the search bar when a document has scanned pages. It reads Indonesian and English, entirely on this computer: nothing is uploaded, and the page looks the same
- Bookmarks: the sidebar has a Bookmarks tab with the document's table of contents. Click one to jump there, and add, rename, nest, reorder or delete them; they're saved in the PDF. Merged files keep each file's bookmarks
- Print (Cmd/Ctrl+P): prints the document as you see it, unsaved changes included
- Edit history: when you change printed text (Edit text), cover content (White-out) or black out areas, saving adds a line to the file's edit history with the date, KlikPaper and the pages changed. Badges in the toolbar say so while you edit, and files changed before show "Edited before" or "Blacked out"; click them, or open Document info, to read more. It's there for transparency (nothing about you is recorded), and "Remove document info and metadata" leaves it out
- Clicking the active tool again puts it away (back to Select)
- In a narrow window the toolbar keeps Save, the ⋯ menu and every tool in view
- The README explains how to share private documents safely and what KlikPaper writes into your PDFs
- AI agents can black out (`redact_text`, `redact_area`, `remove_redactions`), recognize text (`recognize_text`) and work with bookmarks (`list_bookmarks`, `add_bookmark`, `remove_bookmarks`)

## 0.1.11

- Right-click menus: right-click a page, selected text, an annotation, a comment pin, a page thumbnail, a tab or a recent file to get the actions for it, such as highlight or copy the selected text, add a comment or text right where you clicked, duplicate or delete an annotation, rotate, insert or delete pages, close other tabs, or show the file in Finder/Explorer

## 0.1.10

- Comments: pick the comment tool and click a spot on a page to leave a comment, then reply, mark it done or drag its pin in the new Comments panel (Cmd/Ctrl+Shift+K). Comments are saved inside the PDF as standard notes, so the people you send the file to can read and answer them in KlikPaper, Acrobat or Preview
- When an open file changes elsewhere (say, a colleague saves it in a shared Google Drive, Dropbox or OneDrive folder), KlikPaper reloads it; if you have unsaved changes, it adds their new comments so saving keeps both
- Set the name your comments are signed with in Settings
- AI agents can read and write comments too (`list_comments`, `add_comment`, `reply_comment`, `resolve_comment`, `delete_comment`)

## 0.1.9

- Resize pages shows a live preview: the page on the paper you pick, with the margin and how much the content is scaled, before you apply

## 0.1.8

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
