//! Explorer right-click actions on Windows ("Merge with KlikPaper", ...). The
//! entries live under the user's own registry classes (no admin rights) and
//! launch KlikPaper with `--action <id> <file>`. Explorer starts one process per
//! selected file; the single-instance plugin forwards them all to the running
//! window, and the frontend batches what arrives together.
use crate::pdf::{self, images};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// What the right-click menu asked for, until the frontend takes it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ShellAction {
    pub action: String,
    pub paths: Vec<String>,
}

#[derive(Default)]
pub struct ShellActions(pub Mutex<Vec<ShellAction>>);

/// Actions on PDFs, then the one on images.
const PDF_ACTIONS: [&str; 3] = ["merge", "compress", "images"];
const IMAGE_ACTION: &str = "to-pdf";

/// The `--action` launch, with its files resolved against `cwd`; None for a plain launch.
pub fn parse(args: impl IntoIterator<Item = String>, cwd: Option<&str>) -> Option<ShellAction> {
    let mut action = None;
    let mut files = Vec::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--action" {
            action = args.next();
        } else if !arg.starts_with('-') {
            let p = PathBuf::from(&arg);
            files.push(match cwd {
                Some(dir) if p.is_relative() => PathBuf::from(dir).join(p),
                _ => p,
            });
        }
    }
    let action = action.filter(|a| PDF_ACTIONS.contains(&a.as_str()) || a == IMAGE_ACTION)?;
    let wanted: &[&str] = if action == IMAGE_ACTION { &images::EXTENSIONS } else { &["pdf"] };
    let paths = files
        .into_iter()
        .filter(|p| pdf::has_extension(p, wanted) && p.is_file())
        .map(|p| p.display().to_string())
        .collect();
    Some(ShellAction { action, paths })
}

/// Menu labels in the interface language, from the frontend.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Deserialize)]
pub struct Labels {
    pub merge: String,
    pub compress: String,
    pub images: String,
    #[serde(rename = "toPdf")]
    pub to_pdf: String,
}

#[cfg(windows)]
mod registry {
    use super::{IMAGE_ACTION, Labels, PDF_ACTIONS};
    use crate::pdf::images;
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    fn shell_key(ext: &str) -> String {
        format!(r"Software\Classes\SystemFileAssociations\.{ext}\shell")
    }

    /// Registry key name of each action's verb.
    fn verb(action: &str) -> String {
        format!("KlikPaper.{action}")
    }

    /// Every (extension, action) pair that gets a menu entry.
    fn entries() -> impl Iterator<Item = (&'static str, &'static str)> {
        PDF_ACTIONS.iter().map(|a| ("pdf", *a)).chain(images::EXTENSIONS.iter().map(|e| (*e, IMAGE_ACTION)))
    }

    pub fn installed() -> bool {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!(r"{}\{}", shell_key("pdf"), verb("merge"))).is_ok()
    }

    pub fn install(labels: &Labels) -> std::io::Result<()> {
        let exe = std::env::current_exe()?.display().to_string();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for (ext, action) in entries() {
            let label = match action {
                "merge" => &labels.merge,
                "compress" => &labels.compress,
                "images" => &labels.images,
                _ => &labels.to_pdf,
            };
            let (key, _) = hkcu.create_subkey(format!(r"{}\{}", shell_key(ext), verb(action)))?;
            key.set_value("MUIVerb", label)?;
            key.set_value("Icon", &format!("\"{exe}\",0"))?;
            // Shown for any number of selected files, not only up to 15.
            key.set_value("MultiSelectModel", &"Player")?;
            let (command, _) = key.create_subkey("command")?;
            command.set_value("", &format!("\"{exe}\" --action {action} \"%1\""))?;
        }
        Ok(())
    }

    pub fn uninstall() -> std::io::Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for (ext, action) in entries() {
            match hkcu.delete_subkey_all(format!(r"{}\{}", shell_key(ext), verb(action))) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        }
        Ok(())
    }
}

/// Whether the menu entries are installed; None where there is no such menu (macOS, Linux).
pub fn menu_installed() -> Option<bool> {
    #[cfg(windows)]
    return Some(registry::installed());
    #[cfg(not(windows))]
    None
}

/// Adds (or refreshes, after an update or a language change) or removes the menu entries.
#[allow(unused_variables)]
pub fn set_menu(enabled: bool, labels: &Labels) -> std::io::Result<()> {
    #[cfg(windows)]
    return if enabled { registry::install(labels) } else { registry::uninstall() };
    #[cfg(not(windows))]
    Err(std::io::Error::other("The right-click menu is only available on Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_actions_and_their_files() {
        let dir = std::env::temp_dir().join(format!("klikpaper-shell-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for f in ["a.pdf", "b.PDF", "c.png", "d.txt"] {
            std::fs::write(dir.join(f), b"x").unwrap();
        }
        let cwd = dir.display().to_string();

        let merge = parse(args(&["--action", "merge", "a.pdf", "c.png", "missing.pdf"]), Some(&cwd)).unwrap();
        assert_eq!(merge.action, "merge");
        assert_eq!(merge.paths, vec![dir.join("a.pdf").display().to_string()]);

        let to_pdf = parse(args(&["--action", "to-pdf", "c.png", "b.PDF", "d.txt"]), Some(&cwd)).unwrap();
        assert_eq!(to_pdf.paths, vec![dir.join("c.png").display().to_string()]);

        // A plain launch, or an unknown action, is not a shell action.
        assert_eq!(parse(args(&["a.pdf"]), Some(&cwd)), None);
        assert_eq!(parse(args(&["--action", "format-disk", "a.pdf"]), Some(&cwd)), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
