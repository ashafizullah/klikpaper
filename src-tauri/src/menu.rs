//! The native menu bar. App actions are sent to the frontend as a `menu`
//! event carrying the item id; About and updates are handled here.
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::updater;

const REPO: &str = "https://github.com/ashafizullah/klikpaper";

/// The webview handles the shortcuts itself. macOS gets real key equivalents
/// (the webview sees the key first); elsewhere the shortcut is only shown,
/// since a native accelerator would fire as well as the page's own handler.
fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, shortcut: Option<&str>) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(keys) = shortcut {
        if cfg!(target_os = "macos") {
            b = b.accelerator(keys);
        } else {
            let keys = keys.replace("CmdOrCtrl", "Ctrl");
            b = MenuItemBuilder::with_id(id, format!("{label}\t{keys}"));
        }
    }
    b.build(app)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let about = AboutMetadataBuilder::new()
        .name(Some(info.name.clone()))
        .version(Some(info.version.to_string()))
        .comments(Some("Free, open-source, lightweight PDF tool".to_string()))
        .copyright(Some("MIT License".to_string()))
        .license(Some("MIT".to_string()))
        .website(Some(REPO.to_string()))
        .website_label(Some("GitHub".to_string()))
        .build();
    let check_updates = item(app, "check-updates", "Check for Updates…", None)?;

    let mut file = SubmenuBuilder::new(app, "File")
        .item(&item(app, "open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&item(app, "images-to-pdf", "New PDF from Images…", None)?)
        .separator()
        .item(&item(app, "save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item(app, "save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&item(app, "compress", "Compress…", None)?)
        .item(&item(app, "export-images", "Export as Images…", None)?)
        .separator()
        .item(&item(app, "close-tab", "Close Tab", Some("CmdOrCtrl+W"))?);
    if !cfg!(target_os = "macos") {
        file = file.separator().text("quit", "Exit");
    }
    let file = file.build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "zoom-in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item(app, "zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item(app, "zoom-fit", "Fit Width", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item(app, "find", "Find…", Some("CmdOrCtrl+F"))?)
        .item(&item(app, "toggle-sidebar", "Show/Hide Pages", Some("CmdOrCtrl+B"))?)
        .item(&item(app, "toggle-ai", "Show/Hide AI Chat", Some("CmdOrCtrl+J"))?)
        .build()?;

    let mut help = SubmenuBuilder::new(app, "Help");
    if !cfg!(target_os = "macos") {
        help = help.about_with_text("About KlikPaper", Some(about.clone())).item(&check_updates).separator();
    }
    let help = help
        .text("website", "KlikPaper on GitHub")
        .text("issues", "Report an Issue")
        .text("releases", "Release Notes")
        .item(&item(app, "licenses", "Open-Source Licenses", None)?)
        .build()?;

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, info.name.clone())
            .about(Some(about))
            .item(&check_updates)
            .item(&item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        // Undo and redo are the app's own (they undo page and annotation
        // edits); cut/copy/paste/select all stay native so text fields work.
        let edit = SubmenuBuilder::new(app, "Edit")
            .item(&item(app, "undo", "Undo", Some("CmdOrCtrl+Z"))?)
            .item(&item(app, "redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &help])
    } else {
        let edit = SubmenuBuilder::new(app, "Edit")
            .item(&item(app, "undo", "Undo", Some("CmdOrCtrl+Z"))?)
            .item(&item(app, "redo", "Redo", Some("CmdOrCtrl+Y"))?)
            .separator()
            .item(&item(app, "settings", "Settings…", None)?)
            .build()?;
        Menu::with_items(app, &[&file, &edit, &view, &help])
    }
}

pub fn handle(app: &AppHandle, id: &str) {
    let open = |url: String| {
        let _ = app.opener().open_url(url, None::<&str>);
    };
    match id {
        "check-updates" => {
            let app = app.clone();
            std::thread::spawn(move || tauri::async_runtime::block_on(updater::check(app, true)));
        }
        "quit" => app.exit(0),
        "website" => open(REPO.to_string()),
        "issues" => open(format!("{REPO}/issues")),
        "releases" => open(format!("{REPO}/releases")),
        _ => {
            let _ = app.emit("menu", id);
        }
    }
}
