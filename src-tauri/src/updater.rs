//! Self-update from GitHub Releases. The release workflow publishes a signed
//! `latest.json`; the updater only installs packages signed with our key.
//!
//! The user picks how (Settings → General): "auto" downloads new versions in
//! the background and installs them when the app quits or the user restarts
//! from the notice; "notify" asks first; "off" only checks on request. The
//! frontend shows every message, in the interface language.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

const STARTUP_DELAY: Duration = Duration::from_secs(10);
const INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// How often the background thread looks at the mode, so turning updates on takes effect soon.
const TICK: Duration = Duration::from_secs(60);

static CHECKING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    /// The frontend hasn't said yet (it does right after launch).
    Unset,
    Auto,
    Notify,
    Off,
}

static MODE: AtomicU8 = AtomicU8::new(0);
/// A downloaded, verified update waiting to be installed.
static PENDING: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);

fn mode() -> Mode {
    match MODE.load(Ordering::SeqCst) {
        1 => Mode::Auto,
        2 => Mode::Notify,
        3 => Mode::Off,
        _ => Mode::Unset,
    }
}

pub fn set_mode(mode: &str) {
    let m = match mode {
        "auto" => 1,
        "notify" => 2,
        _ => 3,
    };
    MODE.store(m, Ordering::SeqCst);
    // Only "auto" installs without asking.
    if m != 1 {
        PENDING.lock().unwrap().take();
    }
}

/// A new version the frontend can show: its number, the running one, and the release notes.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    version: String,
    current: String,
    notes: String,
}

impl Release {
    fn of(update: &Update) -> Self {
        Release {
            version: update.version.clone(),
            current: update.current_version.clone(),
            notes: notes(update.body.as_deref().unwrap_or("")),
        }
    }
}

/// The outcome of a check the user asked for.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Check {
    Available(Release),
    UpToDate {
        current: String,
    },
    /// A check or download is already running.
    Busy,
}

/// A version found by a check, waiting for the user to agree to install it.
static AVAILABLE: Mutex<Option<Update>> = Mutex::new(None);

pub fn pending() -> Option<Release> {
    PENDING.lock().unwrap().as_ref().map(|(u, _)| Release::of(u))
}

/// Checks shortly after launch and then once a day, as the chosen mode says.
pub fn start_background_checks(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        let mut last: Option<Instant> = None;
        loop {
            let due = last.is_none_or(|t| t.elapsed() >= INTERVAL);
            match mode() {
                Mode::Auto if due => {
                    last = Some(Instant::now());
                    tauri::async_runtime::block_on(download(app.clone()));
                }
                Mode::Notify if due => {
                    last = Some(Instant::now());
                    if let Ok(Check::Available(release)) = tauri::async_runtime::block_on(check(&app)) {
                        let _ = app.emit("update-available", release);
                    }
                }
                _ => {}
            }
            std::thread::sleep(TICK);
        }
    });
}

/// Downloads a new version quietly and tells the frontend it is ready.
async fn download(app: AppHandle) {
    if PENDING.lock().unwrap().is_some() || CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(Some(update)) = async { app.updater()?.check().await }.await
        && let Ok(bytes) = update.download(|_, _| {}, || {}).await
    {
        *PENDING.lock().unwrap() = Some((update, bytes));
        if let Some(ready) = pending() {
            let _ = app.emit("update-ready", ready);
        }
    }
    CHECKING.store(false, Ordering::SeqCst);
}

/// Looks for a newer version and keeps it for `install_available`.
pub async fn check(app: &AppHandle) -> Result<Check, String> {
    if let Some(ready) = pending() {
        // Already downloaded in the background: offer that one.
        return Ok(Check::Available(ready));
    }
    if CHECKING.swap(true, Ordering::SeqCst) {
        return Ok(Check::Busy);
    }
    let result = async { app.updater()?.check().await }.await;
    CHECKING.store(false, Ordering::SeqCst);
    match result.map_err(|e| e.to_string())? {
        Some(update) => {
            let release = Release::of(&update);
            *AVAILABLE.lock().unwrap() = Some(update);
            Ok(Check::Available(release))
        }
        None => Ok(Check::UpToDate { current: app.package_info().version.to_string() }),
    }
}

/// Installs what `check` found (or what was downloaded already) and restarts into it.
pub async fn install_available(app: &AppHandle) -> Result<(), String> {
    if PENDING.lock().unwrap().is_some() {
        return install_now(app);
    }
    let update = AVAILABLE.lock().unwrap().take().ok_or("No update to install; check again")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}

/// Installs the downloaded update and restarts into it.
pub fn install_now(app: &AppHandle) -> Result<(), String> {
    let (update, bytes) = PENDING.lock().unwrap().take().ok_or("No update has been downloaded")?;
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}

/// Installs a downloaded update as the app quits, so the next launch runs it.
pub fn install_on_exit() {
    if let Some((update, bytes)) = PENDING.lock().unwrap().take() {
        let _ = update.install(bytes);
    }
}

/// The changelog part of the release notes (Markdown): the install
/// instructions after "## Download" are for people on the release page.
fn notes(body: &str) -> String {
    let end = body.lines().position(|l| l.trim_start().starts_with("## Download")).unwrap_or(usize::MAX);
    body.lines().take(end).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// A version's changelog in the interface language, from the repository at that
/// version's tag (the release notes on GitHub are English only).
pub async fn changelog(version: &str, locale: &str) -> Result<String, String> {
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return Err("Invalid version".into());
    }
    let file = if locale == "id" { "CHANGELOG.id.md" } else { "CHANGELOG.md" };
    let url = format!("https://raw.githubusercontent.com/ashafizullah/klikpaper/v{version}/{file}");
    let res = reqwest::get(url).await.map_err(|e| e.to_string())?;
    res.error_for_status().map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::notes;

    #[test]
    fn keeps_the_changelog_part_of_the_notes() {
        let body = "\n- **QR** scanning in `Copy Text` mode\n- OCR on macOS 27\n\n## Download\n\n**macOS**: download `KlikPaper.dmg`";
        assert_eq!(notes(body), "- **QR** scanning in `Copy Text` mode\n- OCR on macOS 27");
        assert_eq!(notes("## Download\n\n**Windows**: download it"), "");
    }
}
