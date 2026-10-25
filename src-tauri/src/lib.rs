mod ai;
mod commands;
mod error;
mod files;
mod keys;
mod mcp;
mod menu;
pub mod pdf;
mod updater;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

/// PDFs the OS asked to open (launch arguments, "Open With", Finder) until the frontend takes them.
#[derive(Default)]
pub struct Opened(pub Mutex<Vec<String>>);

fn pdf_paths(args: impl IntoIterator<Item = String>, cwd: Option<&str>) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            match cwd {
                Some(dir) if p.is_relative() => PathBuf::from(dir).join(p),
                _ => p,
            }
        })
        .filter(|p| pdf::has_extension(p, &["pdf"]) && p.is_file())
        .map(|p| p.display().to_string())
        .collect()
}

/// Queues the files and tells a running frontend about them.
fn open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<Opened>().0.lock().unwrap().extend(paths.iter().cloned());
    let _ = app.emit("open-files", paths);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = pdf_paths(args.into_iter().skip(1), Some(&cwd));
            if paths.is_empty() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            } else {
                open_files(app, paths);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Opened::default())
        .setup(|app| {
            app.set_menu(menu::build(app.handle())?)?;
            app.on_menu_event(|app, event| menu::handle(app, event.id().as_ref()));
            let data = app.path().app_data_dir()?;
            keys::init(data.clone());
            app.manage(mcp::Mcp::new(data));
            app.manage(files::Temp::new(app.path().app_cache_dir()?));
            let launch = pdf_paths(std::env::args().skip(1), None);
            app.state::<Opened>().0.lock().unwrap().extend(launch);
            // Debug builds are not released, so they have nothing to update to.
            if !cfg!(debug_assertions) {
                updater::start_background_checks(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::file_stats,
            commands::temp_file,
            commands::move_file,
            commands::discard_temp,
            commands::take_opened_files,
            commands::pdf_info,
            commands::pdf_assemble,
            commands::images_to_pdf,
            commands::api_keys_status,
            commands::api_key_set,
            commands::api_key_delete,
            commands::ai_chat,
            commands::mcp_start,
            commands::mcp_stop,
            commands::mcp_link,
            commands::mcp_reply,
            commands::check_updates,
            commands::dev_autostart_mcp,
        ])
        .build(tauri::generate_context!())
        .expect("error while building KlikPaper");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = &event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.display().to_string());
            open_files(app, pdf_paths(paths, None));
        }
        let _ = (app, event);
    });
}
