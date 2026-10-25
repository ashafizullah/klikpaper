//! Tauri command surface exposed to the webview.
use crate::ai::{self, ChatRequest, ChatResult};
use crate::error::{AppError, AppResult};
use crate::files::{self, Temp};
use crate::mcp::{Mcp, McpCall, McpInfo, McpLink};
use crate::pdf::{self, AssembleJob, AssembleResult, PdfInfo, images};
use crate::{Opened, keys, updater};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, State};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::msg(e.to_string()))?
}

// ---- files ----------------------------------------------------------------

/// The file's bytes, sent raw (no JSON encoding) for pdf.js and pdf-lib.
#[tauri::command]
pub async fn read_file(path: String, temp: State<'_, Temp>) -> AppResult<Response> {
    let path = PathBuf::from(path);
    files::check_readable(&temp, &path)?;
    let bytes = blocking(move || Ok(std::fs::read(&path)?)).await?;
    Ok(Response::new(bytes))
}

/// The body is the raw file content; the target path comes in the `x-path`
/// header (URI-encoded) since a raw body leaves no room for arguments.
#[tauri::command]
pub async fn write_file(request: Request<'_>) -> AppResult<()> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err(AppError::msg("Expected raw file content")) };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(decode_uri)
        .ok_or_else(|| AppError::msg("Missing x-path header"))?;
    let path = PathBuf::from(path);
    files::check_writable(&path)?;
    let bytes = bytes.clone();
    blocking(move || files::write_atomic(&path, &bytes)).await
}

fn decode_uri(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
        {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    path: String,
    exists: bool,
    bytes: u64,
}

/// Existence and size of PDFs and images (other files are reported as missing).
#[tauri::command]
pub fn file_stats(paths: Vec<String>, temp: State<'_, Temp>) -> Vec<FileStat> {
    paths
        .into_iter()
        .map(|path| {
            let allowed = files::check_readable(&temp, Path::new(&path)).is_ok();
            let meta = std::fs::metadata(&path).ok().filter(|m| allowed && m.is_file());
            FileStat { exists: meta.is_some(), bytes: meta.map_or(0, |m| m.len()), path }
        })
        .collect()
}

/// A fresh path in the scratch folder.
#[tauri::command]
pub fn temp_file(ext: String, temp: State<'_, Temp>) -> AppResult<String> {
    Ok(temp.file(&ext)?.display().to_string())
}

#[tauri::command]
pub async fn move_file(from: String, to: String, temp: State<'_, Temp>) -> AppResult<()> {
    files::move_into_place(&temp, Path::new(&from), Path::new(&to))
}

#[tauri::command]
pub fn discard_temp(path: String, temp: State<'_, Temp>) {
    let path = PathBuf::from(path);
    if temp.contains(&path) {
        let _ = std::fs::remove_file(path);
    }
}

/// Files the OS asked KlikPaper to open before the window was ready.
#[tauri::command]
pub fn take_opened_files(opened: State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *opened.0.lock().unwrap())
}

// ---- PDF ------------------------------------------------------------------

#[tauri::command]
pub async fn pdf_info(path: String, password: Option<String>, temp: State<'_, Temp>) -> AppResult<PdfInfo> {
    files::check_readable(&temp, Path::new(&path))?;
    blocking(move || pdf::info(Path::new(&path), password.as_deref())).await
}

#[tauri::command]
pub async fn pdf_assemble(job: AssembleJob, temp: State<'_, Temp>) -> AppResult<AssembleResult> {
    for source in &job.sources {
        files::check_readable(&temp, Path::new(&source.path))?;
    }
    files::check_writable(Path::new(&job.output))?;
    blocking(move || pdf::assemble(&job)).await
}

#[tauri::command]
pub async fn images_to_pdf(job: images::ImagesJob, temp: State<'_, Temp>) -> AppResult<images::ImagesResult> {
    for image in &job.images {
        files::check_readable(&temp, Path::new(image))?;
    }
    files::check_writable(Path::new(&job.output))?;
    blocking(move || images::images_to_pdf(&job)).await
}

// ---- AI -------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    TextDelta { text: String },
}

#[tauri::command]
pub fn api_keys_status(profile_ids: Vec<String>) -> AppResult<HashMap<String, bool>> {
    keys::status(&profile_ids)
}

#[tauri::command]
pub fn api_key_set(profile_id: String, key: String) -> AppResult<()> {
    keys::set(&profile_id, &key)
}

#[tauri::command]
pub fn api_key_delete(profile_id: String) -> AppResult<()> {
    keys::delete(&profile_id)
}

#[tauri::command]
pub async fn ai_chat(request: ChatRequest, on_event: Channel<AiStreamEvent>) -> AppResult<ChatResult> {
    let mut sink = move |t: &str| {
        let _ = on_event.send(AiStreamEvent::TextDelta { text: t.to_string() });
    };
    ai::chat(&request, &mut sink).await
}

// ---- MCP ------------------------------------------------------------------

#[tauri::command]
pub async fn mcp_start(
    tools: serde_json::Value,
    instructions: String,
    on_call: Channel<McpCall>,
    state: State<'_, Mcp>,
) -> AppResult<McpInfo> {
    state.start(tools, instructions, on_call).await
}

#[tauri::command]
pub fn mcp_stop(state: State<'_, Mcp>) {
    state.stop();
}

#[tauri::command]
pub fn mcp_link(state: State<'_, Mcp>) -> McpLink {
    state.link()
}

#[tauri::command]
pub fn mcp_reply(id: u64, result: serde_json::Value, state: State<'_, Mcp>) {
    state.reply(id, result);
}

// ---- app ------------------------------------------------------------------

/// Debug builds only: `KLIKPAPER_DEV_MCP=1` starts the MCP server at launch so
/// the app can be exercised end to end from a script. Always false in releases.
#[tauri::command]
pub fn dev_autostart_mcp() -> bool {
    cfg!(debug_assertions) && std::env::var("KLIKPAPER_DEV_MCP").is_ok_and(|v| v == "1")
}

#[tauri::command]
pub fn check_updates(app: AppHandle) {
    // The update dialogs block, so keep them off the main thread.
    std::thread::spawn(move || tauri::async_runtime::block_on(updater::check(app, true)));
}

#[cfg(test)]
mod tests {
    use super::decode_uri;

    #[test]
    fn decodes_uri_components() {
        assert_eq!(decode_uri("%2FUsers%2Fme%2FLaporan%20Akhir%20%E2%9C%93.pdf"), "/Users/me/Laporan Akhir ✓.pdf");
        assert_eq!(decode_uri("plain%2"), "plain%2");
    }
}
