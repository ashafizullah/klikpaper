//! Self-update from GitHub Releases. The release workflow publishes a signed
//! `latest.json`; the updater only installs packages signed with our key.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const STARTUP_DELAY: Duration = Duration::from_secs(10);
const INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

static CHECKING: AtomicBool = AtomicBool::new(false);

/// Checks shortly after launch and then once a day.
pub fn start_background_checks(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        loop {
            tauri::async_runtime::block_on(check(app.clone(), false));
            std::thread::sleep(INTERVAL);
        }
    });
}

/// The changelog part of the release notes as plain text: the dialog can't
/// render markdown, and the install instructions after "## Download" are for
/// people downloading from the release page.
fn changelog(notes: &str) -> String {
    let mut out = Vec::new();
    for line in notes.lines() {
        let line = line.trim_end();
        if line.trim_start().starts_with("## Download") {
            break;
        }
        let line = if let Some(heading) = line.trim_start().strip_prefix('#') {
            heading.trim_start_matches('#').trim().to_string()
        } else if let Some(item) = line.strip_prefix("- ").or(line.strip_prefix("* ")) {
            format!("• {item}")
        } else {
            line.to_string()
        };
        out.push(strip_inline(&line));
    }
    // Collapse runs of blank lines and trim the ends.
    let mut text = String::new();
    for line in out {
        if line.is_empty() && (text.is_empty() || text.ends_with("\n\n")) {
            continue;
        }
        text.push_str(&line);
        text.push('\n');
    }
    text.trim().to_string()
}

/// Drops `**`, `__` and backticks, and turns `[text](url)` into `text`.
fn strip_inline(line: &str) -> String {
    let line = line.replace("**", "").replace("__", "").replace('`', "");
    let mut out = String::new();
    let mut rest = line.as_str();
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find("](").map(|i| open + i) else {
            break;
        };
        let Some(end) = rest[close..].find(')').map(|i| close + i) else {
            break;
        };
        out.push_str(&rest[..open]);
        out.push_str(&rest[open + 1..close]);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

fn notify(app: &AppHandle, kind: MessageDialogKind, message: String) {
    app.dialog().message(message).title("KlikPaper").kind(kind).blocking_show();
}

/// `manual` checks also report "up to date" and errors; background checks stay quiet.
pub async fn check(app: AppHandle, manual: bool) {
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };
    match result {
        Ok(Some(update)) => {
            let notes = changelog(update.body.as_deref().unwrap_or(""));
            let notes = if notes.chars().count() > 900 { format!("{}…", notes.chars().take(900).collect::<String>()) } else { notes };
            let message = format!("KlikPaper {} is available. You have {}.\n\n{notes}", update.version, update.current_version);
            let install = app
                .dialog()
                .message(message.trim_end())
                .title("Update available")
                .buttons(MessageDialogButtons::OkCancelCustom("Install and Restart".into(), "Later".into()))
                .blocking_show();
            if install {
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app.restart(),
                    Err(e) => notify(&app, MessageDialogKind::Error, format!("The update could not be installed.\n\n{e}")),
                }
            }
        }
        Ok(None) if manual => notify(
            &app,
            MessageDialogKind::Info,
            format!("You're up to date. KlikPaper {} is the latest version.", app.package_info().version),
        ),
        Err(e) if manual => notify(&app, MessageDialogKind::Error, format!("Couldn't check for updates.\n\n{e}")),
        _ => {}
    }
    CHECKING.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::changelog;

    #[test]
    fn keeps_the_changelog_as_plain_text() {
        let notes = "\n### New\n\n- **QR** scanning in `Copy Text` mode\n* See [the docs](https://x.y)\n\n\n### Fixes\n\n- OCR on macOS 27\n\n## Download\n\n**macOS**: download `KlikPaper.dmg`";
        assert_eq!(changelog(notes), "New\n\n• QR scanning in Copy Text mode\n• See the docs\n\nFixes\n\n• OCR on macOS 27");
    }

    #[test]
    fn is_empty_without_a_changelog() {
        assert_eq!(changelog("## Download\n\n**Windows**: download it"), "");
    }
}
