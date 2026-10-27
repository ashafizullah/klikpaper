//! Fonts installed on this computer, for text added to PDFs. The webview shows
//! text with the same face bytes the saved PDF embeds, so screen and file match.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
    /// Has an upright face of weight 600 or more.
    pub bold: bool,
}

static DB: OnceLock<fontdb::Database> = OnceLock::new();

/// Scanned once per session (takes a moment on machines with many fonts).
fn db() -> &'static fontdb::Database {
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// Installed families, sorted by name.
pub fn list() -> Vec<SystemFont> {
    group(db().faces().filter_map(|f| {
        let family = f.families.first()?.0.clone();
        Some((family, f.weight.0, f.style != fontdb::Style::Normal))
    }))
}

fn group(faces: impl Iterator<Item = (String, u16, bool)>) -> Vec<SystemFont> {
    let mut by_family: BTreeMap<String, bool> = BTreeMap::new();
    for (family, weight, italic) in faces {
        // Dot-prefixed families are private system UI fonts (macOS ".SF NS").
        if family.is_empty() || family.starts_with('.') {
            continue;
        }
        *by_family.entry(family).or_default() |= weight >= 600 && !italic;
    }
    let mut out: Vec<SystemFont> = by_family.into_iter().map(|(family, bold)| SystemFont { family, bold }).collect();
    out.sort_by_key(|f| f.family.to_lowercase());
    out
}

/// The regular or bold face of an installed family as a standalone font file
/// (faces in .ttc collections are copied out), ready to embed in a PDF.
pub fn face(family: &str, bold: bool) -> AppResult<Vec<u8>> {
    let query = fontdb::Query {
        families: &[fontdb::Family::Name(family)],
        weight: if bold { fontdb::Weight::BOLD } else { fontdb::Weight::NORMAL },
        stretch: fontdb::Stretch::Normal,
        style: fontdb::Style::Normal,
    };
    let id = db().query(&query).ok_or_else(|| AppError::msg(format!("The font {family} is not installed")))?;
    let bytes = db().with_face_data(id, single_face).ok_or_else(|| AppError::msg(format!("Couldn't read the font {family}")))??;
    if !embeddable(&bytes) {
        return Err(AppError::msg(format!("The license of {family} doesn't allow embedding it in documents; pick another font")));
    }
    Ok(bytes)
}

fn be16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn be32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

/// Face `index` of a font file; a collection (.ttc/.otc) is rebuilt as a single font.
fn single_face(data: &[u8], index: u32) -> AppResult<Vec<u8>> {
    if data.get(0..4) != Some(b"ttcf") {
        return Ok(data.to_vec());
    }
    extract(data, index).ok_or_else(|| AppError::msg("Unreadable font collection"))
}

fn extract(data: &[u8], index: u32) -> Option<Vec<u8>> {
    if index >= be32(data, 8)? {
        return None;
    }
    let start = be32(data, 12 + 4 * index as usize)? as usize;
    let count = be16(data, start + 4)? as usize;
    // sfnt header, then one 16-byte record per table, then the tables (4-byte aligned).
    let mut head = data.get(start..start + 12)?.to_vec();
    let mut body = Vec::new();
    let mut offset = 12 + 16 * count;
    for i in 0..count {
        let rec = data.get(start + 12 + 16 * i..start + 28 + 16 * i)?;
        let (from, len) = (be32(rec, 8)? as usize, be32(rec, 12)? as usize);
        head.extend_from_slice(&rec[..8]);
        head.extend_from_slice(&(offset as u32).to_be_bytes());
        head.extend_from_slice(&(len as u32).to_be_bytes());
        body.extend_from_slice(data.get(from..from + len)?);
        let padded = len.div_ceil(4) * 4;
        body.resize(body.len() + padded - len, 0);
        offset += padded;
    }
    head.extend(body);
    Some(head)
}

/// False when the font's OS/2 fsType says "restricted license embedding".
fn embeddable(font: &[u8]) -> bool {
    let tables = be16(font, 4).unwrap_or(0) as usize;
    for i in 0..tables {
        let rec = 12 + 16 * i;
        if font.get(rec..rec + 4) == Some(b"OS/2") {
            let fs_type = be32(font, rec + 8).and_then(|at| be16(font, at as usize + 8)).unwrap_or(0);
            return fs_type & 0x000f != 0x0002;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal sfnt with the given (tag, data) tables.
    fn sfnt(tables: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let mut head = vec![0, 1, 0, 0];
        head.extend((tables.len() as u16).to_be_bytes());
        head.extend([0; 6]);
        let mut body = Vec::new();
        let mut offset = 12 + 16 * tables.len();
        for (tag, data) in tables {
            head.extend(*tag);
            head.extend([0; 4]);
            head.extend((offset as u32).to_be_bytes());
            head.extend((data.len() as u32).to_be_bytes());
            body.extend(*data);
            let padded = data.len().div_ceil(4) * 4;
            body.resize(body.len() + padded - data.len(), 0);
            offset += padded;
        }
        head.extend(body);
        head
    }

    /// Wraps fonts in a collection; table offsets are rebased onto the collection.
    fn ttc(fonts: &[Vec<u8>]) -> Vec<u8> {
        let mut out = b"ttcf".to_vec();
        out.extend([0, 1, 0, 0]);
        out.extend((fonts.len() as u32).to_be_bytes());
        let mut at = 12 + 4 * fonts.len();
        let mut blobs = Vec::new();
        for f in fonts {
            out.extend((at as u32).to_be_bytes());
            let mut f = f.clone();
            let count = be16(&f, 4).unwrap() as usize;
            for i in 0..count {
                let rec = 12 + 16 * i;
                let rebased = be32(&f, rec + 8).unwrap() + at as u32;
                f[rec + 8..rec + 12].copy_from_slice(&rebased.to_be_bytes());
            }
            at += f.len();
            blobs.extend(f);
        }
        out.extend(blobs);
        out
    }

    #[test]
    fn copies_a_face_out_of_a_collection() {
        let a = sfnt(&[(b"cmap", b"aaa"), (b"glyf", b"AAAAAA")]);
        let b = sfnt(&[(b"cmap", b"bbbbb"), (b"glyf", b"B")]);
        let collection = ttc(&[a, b.clone()]);
        assert_eq!(single_face(&collection, 1).unwrap(), b);
        assert!(single_face(&collection, 2).is_err());
        // A plain font comes back as is.
        assert_eq!(single_face(&b, 0).unwrap(), b);
    }

    #[test]
    fn honors_restricted_embedding() {
        let os2 = |fs_type: u16| {
            let mut t = vec![0u8; 10];
            t[8..10].copy_from_slice(&fs_type.to_be_bytes());
            sfnt(&[(b"OS/2", &t)])
        };
        assert!(embeddable(&os2(0)));
        assert!(embeddable(&os2(0x0004)));
        assert!(embeddable(&os2(0x0008)));
        assert!(!embeddable(&os2(0x0002)));
        assert!(embeddable(&sfnt(&[(b"cmap", b"x")])));
    }

    #[test]
    fn groups_faces_by_family() {
        let faces = [("Avenir", 400, false), ("Avenir", 800, false), ("Menlo", 700, true), (".SF NS", 400, false), ("arial", 400, false)];
        let fonts = group(faces.into_iter().map(|(f, w, i)| (f.to_string(), w, i)));
        assert_eq!(
            fonts,
            vec![
                SystemFont { family: "arial".into(), bold: false },
                SystemFont { family: "Avenir".into(), bold: true },
                SystemFont { family: "Menlo".into(), bold: false },
            ]
        );
    }

    /// Reads real installed fonts; run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_installed_fonts() {
        let fonts = list();
        println!("{} families", fonts.len());
        for f in fonts.iter().take(400) {
            match face(&f.family, false) {
                Ok(bytes) => assert!(bytes.len() > 12, "{}", f.family),
                Err(e) => println!("{}: {e}", f.family),
            }
        }
    }
}
