//! Right-click actions on files ("Merge with KlikPaper", ...): Windows Explorer
//! entries under the user's own registry classes (no admin rights), and macOS
//! Finder Quick Actions in ~/Library/Services. Both launch KlikPaper with
//! `--action <id> <files>`; the single-instance plugin forwards each launch to
//! the running window, and the frontend batches what arrives together (Explorer
//! starts one process per selected file).
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
    let paths = files.into_iter().filter(|p| pdf::has_extension(p, wanted) && p.is_file()).map(|p| p.display().to_string()).collect();
    Some(ShellAction { action, paths })
}

/// Menu labels in the interface language, from the frontend.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
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
            let label = labels.of(action);
            let (key, _) = hkcu.create_subkey(format!(r"{}\{}", shell_key(ext), verb(action)))?;
            key.set_value("MUIVerb", &label)?;
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

impl Labels {
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    fn of(&self, action: &str) -> &str {
        match action {
            "merge" => &self.merge,
            "compress" => &self.compress,
            "images" => &self.images,
            _ => &self.to_pdf,
        }
    }
}

#[cfg(target_os = "macos")]
mod quick_actions {
    //! One Automator Quick Action per action. Finder hands a Quick Action all the
    //! selected files at once, and it passes them to KlikPaper in one launch.
    use super::{IMAGE_ACTION, Labels, PDF_ACTIONS};
    use std::path::{Path, PathBuf};

    fn dir() -> std::io::Result<PathBuf> {
        let home = std::env::var_os("HOME").ok_or_else(|| std::io::Error::other("No home folder"))?;
        Ok(PathBuf::from(home).join("Library/Services"))
    }

    /// Stable file names, so a language change replaces the same workflows.
    fn bundle(dir: &Path, action: &str) -> PathBuf {
        dir.join(format!("KlikPaper {action}.workflow"))
    }

    fn xml(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    fn sh(s: &str) -> String {
        format!("'{}'", s.replace('\'', r"'\''"))
    }

    /// The command the Quick Action runs with the selected files as "$@".
    pub(super) fn script(exe: &Path, action: &str) -> String {
        // Inside the app bundle, launch through Launch Services like a double-click; a new
        // instance hands its files to a running one and quits.
        match exe.ancestors().nth(3).filter(|app| app.extension().is_some_and(|e| e == "app")) {
            Some(app) => format!("/usr/bin/open -n -a {} --args --action {action} \"$@\"\n", sh(&app.display().to_string())),
            // A development build has no bundle: start the binary in the background.
            None => format!("nohup {} --action {action} \"$@\" >/dev/null 2>&1 &\n", sh(&exe.display().to_string())),
        }
    }

    fn info_plist(id: &str, label: &str, action: &str) -> String {
        let (uti, _) = input(action);
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>{id}.quick-action.{action}</string>
	<key>CFBundleName</key>
	<string>{label}</string>
	<key>CFBundlePackageType</key>
	<string>BNDL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>{label}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>{uti}</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
"#,
            id = xml(id),
            label = xml(label),
        )
    }

    /// The file type Finder offers the action for, and Automator's name for it.
    fn input(action: &str) -> (&'static str, &'static str) {
        if action == IMAGE_ACTION {
            ("public.image", "com.apple.Automator.fileSystemObject.image")
        } else {
            ("com.adobe.pdf", "com.apple.Automator.fileSystemObject.PDF")
        }
    }

    /// A workflow with one "Run Shell Script" action that gets the files as arguments.
    fn document(script: &str, action: &str) -> String {
        let (_, input) = input(action);
        let uuid = || uuid::Uuid::new_v4().to_string().to_uppercase();
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>521</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>{script}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>{input_uuid}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>{output_uuid}</string>
				<key>UUID</key>
				<string>{action_uuid}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
			</dict>
			<key>isViewVisible</key>
			<true/>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>{input}</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
"#,
            script = xml(script),
            input_uuid = uuid(),
            output_uuid = uuid(),
            action_uuid = uuid(),
        )
    }

    fn actions() -> impl Iterator<Item = &'static str> {
        PDF_ACTIONS.into_iter().chain([IMAGE_ACTION])
    }

    pub fn installed() -> bool {
        dir().is_ok_and(|d| bundle(&d, "merge").is_dir())
    }

    pub fn install_in(dir: &Path, id: &str, exe: &Path, labels: &Labels) -> std::io::Result<()> {
        for action in actions() {
            let contents = bundle(dir, action).join("Contents");
            std::fs::create_dir_all(&contents)?;
            std::fs::write(contents.join("Info.plist"), info_plist(id, labels.of(action), action))?;
            std::fs::write(contents.join("document.wflow"), document(&script(exe, action), action))?;
        }
        Ok(())
    }

    pub fn install(id: &str, labels: &Labels) -> std::io::Result<()> {
        install_in(&dir()?, id, &std::env::current_exe()?, labels)?;
        refresh();
        Ok(())
    }

    pub fn uninstall() -> std::io::Result<()> {
        let dir = dir()?;
        for action in actions() {
            match std::fs::remove_dir_all(bundle(&dir, action)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        }
        refresh();
        Ok(())
    }

    /// Makes Finder pick up the change now rather than at the next login.
    fn refresh() {
        let _ = std::process::Command::new("/System/Library/CoreServices/pbs").arg("-update").status();
    }
}

/// Whether the menu entries are installed; None where there is no such menu (Linux).
pub fn menu_installed() -> Option<bool> {
    #[cfg(windows)]
    return Some(registry::installed());
    #[cfg(target_os = "macos")]
    return Some(quick_actions::installed());
    #[cfg(not(any(windows, target_os = "macos")))]
    None
}

/// Adds (or refreshes, after an update or a language change) or removes the menu entries.
#[allow(unused_variables)]
pub fn set_menu(enabled: bool, id: &str, labels: &Labels) -> std::io::Result<()> {
    #[cfg(windows)]
    return if enabled { registry::install(labels) } else { registry::uninstall() };
    #[cfg(target_os = "macos")]
    return if enabled { quick_actions::install(id, labels) } else { quick_actions::uninstall() };
    #[cfg(not(any(windows, target_os = "macos")))]
    Err(std::io::Error::other("The right-click menu is only available on Windows and macOS"))
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

    #[cfg(target_os = "macos")]
    #[test]
    fn writes_quick_actions() {
        use std::path::Path;
        let script = quick_actions::script(Path::new("/Applications/Klik Paper's.app/Contents/MacOS/klikpaper"), "merge");
        assert_eq!(script, "/usr/bin/open -n -a '/Applications/Klik Paper'\\''s.app' --args --action merge \"$@\"\n");
        let dev = quick_actions::script(Path::new("/src/target/debug/klikpaper"), "compress");
        assert!(dev.starts_with("nohup '/src/target/debug/klikpaper' --action compress"));

        let dir = std::env::temp_dir().join(format!("klikpaper-qa-{}", std::process::id()));
        let labels = Labels { merge: "Gabung & <satukan>".into(), compress: "c".into(), images: "i".into(), to_pdf: "p".into() };
        quick_actions::install_in(&dir, "com.example.app", Path::new("/x/klikpaper"), &labels).unwrap();
        for action in ["merge", "compress", "images", "to-pdf"] {
            let contents = dir.join(format!("KlikPaper {action}.workflow/Contents"));
            for file in ["Info.plist", "document.wflow"] {
                let ok = std::process::Command::new("plutil").arg("-lint").arg(contents.join(file)).output().unwrap().status.success();
                assert!(ok, "{action}/{file} is not a valid plist");
            }
        }
        let info = std::fs::read_to_string(dir.join("KlikPaper merge.workflow/Contents/Info.plist")).unwrap();
        assert!(info.contains("Gabung &amp; &lt;satukan&gt;") && info.contains("com.adobe.pdf"));
        let images = std::fs::read_to_string(dir.join("KlikPaper to-pdf.workflow/Contents/Info.plist")).unwrap();
        assert!(images.contains("public.image"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Runs a generated Quick Action through Automator with a stand-in for the app;
    /// run with `cargo test -- --ignored` (macOS).
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn quick_action_passes_the_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("klikpaper-qa-run-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("args.txt");
        let fake = dir.join("klikpaper");
        std::fs::write(&fake, format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\n", log.display())).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let (a, b) = (dir.join("a file.pdf"), dir.join("b.pdf"));
        std::fs::write(&a, b"x").unwrap();
        std::fs::write(&b, b"x").unwrap();
        let labels = Labels { merge: "m".into(), compress: "c".into(), images: "i".into(), to_pdf: "p".into() };
        quick_actions::install_in(&dir, "com.example.app", &fake, &labels).unwrap();

        let status = std::process::Command::new("automator")
            .arg("-i")
            .arg(format!("{}\n{}", a.display(), b.display()))
            .arg(dir.join("KlikPaper merge.workflow"))
            .status()
            .unwrap();
        assert!(status.success());
        std::thread::sleep(std::time::Duration::from_secs(1));
        let got = std::fs::read_to_string(&log).unwrap();
        assert_eq!(got, format!("--action\nmerge\n{}\n{}\n", a.display(), b.display()));
        let _ = std::fs::remove_dir_all(dir);
    }
}
