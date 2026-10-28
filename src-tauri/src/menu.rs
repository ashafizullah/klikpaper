//! The native menu bar, in the interface language (the frontend rebuilds it
//! with `set_menu_locale`). App actions, update checks included, are sent to the
//! frontend as a `menu` event carrying the item id; links open here.
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

const REPO: &str = "https://github.com/ashafizullah/klikpaper";

/// A label in the interface language: Indonesian for "id", else the English given.
fn tr(locale: &str, en: &'static str) -> &'static str {
    if locale != "id" {
        return en;
    }
    match en {
        "File" => "Berkas",
        "View" => "Tampilan",
        "Help" => "Bantuan",
        "New Tab" => "Tab Baru",
        "Open…" => "Buka…",
        "New PDF from Images…" => "PDF Baru dari Gambar…",
        "Save" => "Simpan",
        "Save As…" => "Simpan Sebagai…",
        "Compress…" => "Kompres…",
        "Resize Pages…" => "Ubah Ukuran Halaman…",
        "Export as Images…" => "Ekspor sebagai Gambar…",
        "Print…" => "Cetak…",
        "Close Tab" => "Tutup Tab",
        "Exit" => "Keluar",
        "Zoom In" => "Perbesar",
        "Zoom Out" => "Perkecil",
        "Fit Width" => "Pas Lebar",
        "Find…" => "Cari…",
        "Show/Hide Pages" => "Tampilkan/Sembunyikan Halaman",
        "Show Bookmarks" => "Tampilkan Bookmark",
        "Show/Hide AI Chat" => "Tampilkan/Sembunyikan Chat AI",
        "Show/Hide Comments" => "Tampilkan/Sembunyikan Komentar",
        "Show/Hide Terminal" => "Tampilkan/Sembunyikan Terminal",
        "About KlikPaper" => "Tentang KlikPaper",
        "Check for Updates…" => "Cek Pembaruan…",
        "KlikPaper on GitHub" => "KlikPaper di GitHub",
        "Report an Issue" => "Laporkan Masalah",
        "Release Notes" => "Catatan Rilis",
        "Open-Source Licenses" => "Lisensi Open Source",
        "Settings…" => "Pengaturan…",
        "Undo" => "Urungkan",
        "Redo" => "Ulangi",
        "Cut" => "Potong",
        "Copy" => "Salin",
        "Paste" => "Tempel",
        "Select All" => "Pilih Semua",
        "Services" => "Layanan",
        "Hide KlikPaper" => "Sembunyikan KlikPaper",
        "Hide Others" => "Sembunyikan Lainnya",
        "Show All" => "Tampilkan Semua",
        "Quit KlikPaper" => "Keluar dari KlikPaper",
        "Free, open-source, lightweight PDF tool" => "Aplikasi PDF gratis, open source, dan ringan",
        other => other,
    }
}

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

pub fn build<R: Runtime>(app: &AppHandle<R>, locale: &str) -> tauri::Result<Menu<R>> {
    let t = |en| tr(locale, en);
    let info = app.package_info();
    let about = AboutMetadataBuilder::new()
        .name(Some(info.name.clone()))
        .version(Some(info.version.to_string()))
        .comments(Some(t("Free, open-source, lightweight PDF tool").to_string()))
        .copyright(Some("MIT License".to_string()))
        .license(Some("MIT".to_string()))
        .website(Some(REPO.to_string()))
        .website_label(Some("GitHub".to_string()))
        .build();
    let check_updates = item(app, "check-updates", t("Check for Updates…"), None)?;

    let mut file = SubmenuBuilder::new(app, t("File"))
        .item(&item(app, "new-tab", t("New Tab"), Some("CmdOrCtrl+T"))?)
        .item(&item(app, "open", t("Open…"), Some("CmdOrCtrl+O"))?)
        .item(&item(app, "images-to-pdf", t("New PDF from Images…"), None)?)
        .separator()
        .item(&item(app, "save", t("Save"), Some("CmdOrCtrl+S"))?)
        .item(&item(app, "save-as", t("Save As…"), Some("CmdOrCtrl+Shift+S"))?)
        .item(&item(app, "compress", t("Compress…"), None)?)
        .item(&item(app, "resize", t("Resize Pages…"), None)?)
        .item(&item(app, "export-images", t("Export as Images…"), None)?)
        .separator()
        .item(&item(app, "print", t("Print…"), Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item(app, "close-tab", t("Close Tab"), Some("CmdOrCtrl+W"))?);
    if !cfg!(target_os = "macos") {
        file = file.separator().text("quit", t("Exit"));
    }
    let file = file.build()?;

    let view = SubmenuBuilder::new(app, t("View"))
        .item(&item(app, "zoom-in", t("Zoom In"), Some("CmdOrCtrl+="))?)
        .item(&item(app, "zoom-out", t("Zoom Out"), Some("CmdOrCtrl+-"))?)
        .item(&item(app, "zoom-fit", t("Fit Width"), Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item(app, "find", t("Find…"), Some("CmdOrCtrl+F"))?)
        .item(&item(app, "toggle-sidebar", t("Show/Hide Pages"), Some("CmdOrCtrl+B"))?)
        .item(&item(app, "toggle-outline", t("Show Bookmarks"), None)?)
        .item(&item(app, "toggle-comments", t("Show/Hide Comments"), Some("CmdOrCtrl+Shift+K"))?)
        .item(&item(app, "toggle-ai", t("Show/Hide AI Chat"), Some("CmdOrCtrl+J"))?)
        .item(&item(app, "toggle-terminal", t("Show/Hide Terminal"), None)?)
        .build()?;

    let mut help = SubmenuBuilder::new(app, t("Help"));
    if !cfg!(target_os = "macos") {
        help = help.about_with_text(t("About KlikPaper"), Some(about.clone())).item(&check_updates).separator();
    }
    let help = help
        .text("website", t("KlikPaper on GitHub"))
        .text("issues", t("Report an Issue"))
        .text("releases", t("Release Notes"))
        .item(&item(app, "licenses", t("Open-Source Licenses"), None)?)
        .build()?;

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, info.name.clone())
            .about_with_text(t("About KlikPaper"), Some(about))
            .item(&check_updates)
            .item(&item(app, "settings", t("Settings…"), Some("CmdOrCtrl+,"))?)
            .separator()
            .services_with_text(t("Services"))
            .separator()
            .hide_with_text(t("Hide KlikPaper"))
            .hide_others_with_text(t("Hide Others"))
            .show_all_with_text(t("Show All"))
            .separator()
            .quit_with_text(t("Quit KlikPaper"))
            .build()?;
        // Undo and redo are the app's own (they undo page and annotation
        // edits); cut/copy/paste/select all stay native so text fields work.
        let edit = SubmenuBuilder::new(app, t("Edit"))
            .item(&item(app, "undo", t("Undo"), Some("CmdOrCtrl+Z"))?)
            .item(&item(app, "redo", t("Redo"), Some("CmdOrCtrl+Shift+Z"))?)
            .separator()
            .cut_with_text(t("Cut"))
            .copy_with_text(t("Copy"))
            .paste_with_text(t("Paste"))
            .select_all_with_text(t("Select All"))
            .build()?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &help])
    } else {
        let edit = SubmenuBuilder::new(app, t("Edit"))
            .item(&item(app, "undo", t("Undo"), Some("CmdOrCtrl+Z"))?)
            .item(&item(app, "redo", t("Redo"), Some("CmdOrCtrl+Y"))?)
            .separator()
            .item(&item(app, "settings", t("Settings…"), None)?)
            .build()?;
        Menu::with_items(app, &[&file, &edit, &view, &help])
    }
}

pub fn handle(app: &AppHandle, id: &str) {
    let open = |url: String| {
        let _ = app.opener().open_url(url, None::<&str>);
    };
    match id {
        "quit" => app.exit(0),
        "website" => open(REPO.to_string()),
        "issues" => open(format!("{REPO}/issues")),
        "releases" => open(format!("{REPO}/releases")),
        _ => {
            let _ = app.emit("menu", id);
        }
    }
}
