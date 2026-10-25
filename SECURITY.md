# Security

Please report security problems privately through [Report a vulnerability](https://github.com/ashafizullah/klikpaper/security/advisories/new), not in a public issue. You'll get a reply within a few days.

Useful to know when looking at KlikPaper:

- The webview can only read PDFs and images and only write `.pdf`, `.png` and `.jpg` files; paths are resolved (symlinks included) before the check (`src-tauri/src/files.rs`).
- The optional MCP server listens on `127.0.0.1` only, requires a random token and rejects browser origins (`src-tauri/src/mcp.rs`).
- AI API keys are kept in the OS keychain and never reach the webview (`src-tauri/src/keys.rs`).
- PDF.js runs with scripting and XFA disabled; decompression is bounded when loading and compressing files.
- Text from a PDF is treated as untrusted data in the AI chat, and file tools never overwrite a file unless asked to.

Only the latest release gets security fixes.
