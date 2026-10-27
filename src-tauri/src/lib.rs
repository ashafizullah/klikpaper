mod ai;
mod commands;
mod error;
mod files;
mod fonts;
mod keys;
mod mcp;
mod menu;
pub mod pdf;
mod shell;
mod terminal;
mod updater;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

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

/// A launch from the OS: a right-click action (Windows Explorer), or PDFs to open.
fn handle_launch(app: &tauri::AppHandle, args: Vec<String>, cwd: Option<&str>) {
    let Some(action) = shell::parse(args.iter().cloned(), cwd) else {
        return open_files(app, pdf_paths(args, cwd));
    };
    app.state::<shell::ShellActions>().0.lock().unwrap().push(action.clone());
    let _ = app.emit("shell-action", action);
    focus(app);
}

fn focus(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Queues the files and tells a running frontend about them.
fn open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<Opened>().0.lock().unwrap().extend(paths.iter().cloned());
    let _ = app.emit("open-files", paths);
    focus(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            focus(app);
            handle_launch(app, args.into_iter().skip(1).collect(), Some(&cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Opened::default())
        .manage(shell::ShellActions::default())
        .manage(terminal::Terminals::default())
        .setup(|app| {
            app.set_menu(menu::build(app.handle(), "en")?)?;
            app.on_menu_event(|app, event| menu::handle(app, event.id().as_ref()));
            let data = app.path().app_data_dir()?;
            keys::init(data.clone());
            app.manage(mcp::Mcp::new(data));
            app.manage(files::Temp::new(app.path().app_cache_dir()?));
            let args: Vec<String> = std::env::args().skip(1).collect();
            match shell::parse(args.iter().cloned(), None) {
                Some(action) => app.state::<shell::ShellActions>().0.lock().unwrap().push(action),
                None => app.state::<Opened>().0.lock().unwrap().extend(pdf_paths(args, None)),
            }
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
            commands::take_shell_actions,
            commands::shell_menu,
            commands::set_shell_menu,
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
            commands::system_fonts,
            commands::font_face,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::check_updates,
            commands::install_available_update,
            commands::update_changelog,
            commands::set_menu_locale,
            commands::set_update_mode,
            commands::pending_update,
            commands::dev_autostart_mcp,
        ])
        .build(tauri::generate_context!())
        .expect("error while building KlikPaper");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.display().to_string());
            open_files(app, pdf_paths(paths, None));
        }
        if let tauri::RunEvent::Exit = event {
            updater::install_on_exit();
        }
        let _ = (app, event);
    });
}
