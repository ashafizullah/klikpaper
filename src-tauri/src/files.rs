//! File access for the webview. Reads and writes are limited to PDFs and
//! images (plus the app's own temp folder), so a page that misbehaves (for
//! example through a malicious PDF) still can't reach other files such as SSH
//! keys or shell profiles.
use crate::error::{AppError, AppResult};
use crate::pdf::{has_extension, images};
use std::path::{Path, PathBuf};

pub const WRITABLE: [&str; 4] = ["pdf", "png", "jpg", "jpeg"];

fn readable(path: &Path) -> bool {
    has_extension(path, &["pdf"]) || has_extension(path, &images::EXTENSIONS)
}

/// A scratch folder for intermediate files, emptied at every launch.
pub struct Temp(PathBuf);

impl Temp {
    pub fn new(cache_dir: PathBuf) -> Self {
        let dir = cache_dir.join("work");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        Temp(dir.canonicalize().unwrap_or(dir))
    }

    pub fn file(&self, ext: &str) -> AppResult<PathBuf> {
        if !WRITABLE.contains(&ext) {
            return Err(AppError::msg(format!("Unsupported file type: {ext}")));
        }
        std::fs::create_dir_all(&self.0)?;
        Ok(self.0.join(format!("{}.{ext}", uuid::Uuid::new_v4().simple())))
    }

    pub fn contains(&self, path: &Path) -> bool {
        path.parent().and_then(|p| p.canonicalize().ok()).is_some_and(|p| p == self.0)
    }
}

/// The file a path really points to, so a link named `x.pdf` can't stand in for
/// another file (for example an SSH key). Paths that don't exist yet are kept.
fn resolved(path: &Path) -> std::path::PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub fn check_readable(temp: &Temp, path: &Path) -> AppResult<()> {
    let real = resolved(path);
    if (readable(path) && readable(&real)) || temp.contains(&real) {
        Ok(())
    } else {
        Err(AppError::msg(format!("KlikPaper only opens PDFs and images ({})", path.display())))
    }
}

pub fn check_writable(path: &Path) -> AppResult<()> {
    // Writing replaces the path itself (temp file + rename), never a link's target,
    // but a link to something else is still refused to keep intent clear.
    let real = resolved(path);
    if has_extension(path, &WRITABLE) && has_extension(&real, &WRITABLE) && path.is_absolute() {
        Ok(())
    } else {
        Err(AppError::msg(format!("KlikPaper only saves PDF, PNG and JPEG files ({})", path.display())))
    }
}

/// Writes through a temporary file next to the target, then renames.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.klikpaper-{}.tmp", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, bytes)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Moves a finished temp file to where the user chose to save it.
pub fn move_into_place(temp: &Temp, from: &Path, to: &Path) -> AppResult<()> {
    if !temp.contains(from) {
        return Err(AppError::msg("Only KlikPaper's own temporary files can be moved"));
    }
    check_writable(to)?;
    if std::fs::rename(from, to).is_err() {
        // Different volumes: copy, then clean up.
        write_atomic(to, &std::fs::read(from)?)?;
        let _ = std::fs::remove_file(from);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pdfs_images_and_temp_files_are_reachable() {
        let base = std::env::temp_dir().join(format!("klikpaper-files-{}", uuid::Uuid::new_v4().simple()));
        let temp = Temp::new(base.clone());
        assert!(check_readable(&temp, Path::new("/x/doc.PDF")).is_ok());
        assert!(check_readable(&temp, Path::new("/x/scan.jpeg")).is_ok());
        assert!(check_readable(&temp, Path::new("/home/me/.ssh/id_ed25519")).is_err());
        assert!(check_writable(Path::new("/home/me/.zshrc")).is_err());
        assert!(check_writable(Path::new("relative.pdf")).is_err());
        assert!(check_writable(Path::new("/x/out.pdf")).is_ok());

        let scratch = temp.file("pdf").unwrap();
        std::fs::write(&scratch, b"%PDF-1.7").unwrap();
        assert!(temp.contains(&scratch));
        assert!(!temp.contains(&base.join("elsewhere.pdf")));
        let dest = base.join("saved.pdf");
        move_into_place(&temp, &scratch, &dest).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"%PDF-1.7");
        assert!(move_into_place(&temp, &dest, &base.join("again.pdf")).is_err());
        assert!(temp.file("sh").is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn links_named_like_pdfs_are_refused() {
        let base = std::env::temp_dir().join(format!("klikpaper-links-{}", uuid::Uuid::new_v4().simple()));
        let temp = Temp::new(base.join("cache"));
        let secret = base.join("id_ed25519");
        std::fs::write(&secret, b"secret").unwrap();
        let link = base.join("innocent.pdf");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        assert!(check_readable(&temp, &link).is_err());
        assert!(check_writable(&link).is_err());
        let real_pdf = base.join("real.pdf");
        std::fs::write(&real_pdf, b"%PDF").unwrap();
        let pdf_link = base.join("alias.pdf");
        std::os::unix::fs::symlink(&real_pdf, &pdf_link).unwrap();
        assert!(check_readable(&temp, &pdf_link).is_ok());
        let _ = std::fs::remove_dir_all(base);
    }
}
