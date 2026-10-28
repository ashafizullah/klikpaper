//! Page-level PDF work with lopdf. Every page operation (merge, split,
//! extract, reorder, rotate, delete) is one `assemble` call that builds a new
//! file from pages of one or more source files, so the open document is only
//! rewritten when the user saves.
pub mod comments;
pub mod compress;
pub mod images;
pub mod outline;
pub mod redact;
pub mod sheet;
mod std14;

use crate::error::{AppError, AppResult};
use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::{Dictionary, Document, EncryptionState, EncryptionVersion, LoadOptions, Object, ObjectId, Permissions};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A stream inflating past this fails to load, so a crafted file can't exhaust memory.
const MAX_DECOMPRESSED: usize = 512 * 1024 * 1024;

/// Page attributes a page may inherit from its ancestors in the page tree (ISO 32000-1, 7.7.3.4).
const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageRef {
    pub source: String,
    /// 0-based page index in the source.
    pub index: u32,
    /// Clockwise degrees added to the page's own rotation (a multiple of 90).
    #[serde(default)]
    pub rotate: i64,
    /// Another paper size to fit the page onto (see `sheet`).
    #[serde(default)]
    pub sheet: Option<sheet::Sheet>,
    /// The page's comment threads, replacing the ones in the file; None leaves them as they are.
    #[serde(default)]
    pub comments: Option<Vec<comments::Thread>>,
    /// Areas whose content is removed and painted black (see `redact`).
    #[serde(default)]
    pub redact: Vec<redact::Area>,
    /// A JPEG of the page (already redacted) that replaces its content, for pages
    /// whose content couldn't be redacted piece by piece.
    #[serde(default)]
    pub raster: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Protect {
    pub user_password: String,
    /// Needed to change permissions; defaults to the user password.
    #[serde(default)]
    pub owner_password: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Drops the document information dictionary and XMP metadata.
    #[serde(default)]
    pub strip_metadata: bool,
    #[serde(default)]
    pub compress: Option<compress::Compression>,
    #[serde(default)]
    pub protect: Option<Protect>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssembleJob {
    pub sources: Vec<Source>,
    pub pages: Vec<PageRef>,
    pub output: String,
    #[serde(default)]
    pub options: Options,
    /// Bookmarks replacing the document's outline; None keeps the base file's.
    #[serde(default)]
    pub outline: Option<Vec<outline::Bookmark>>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssembleResult {
    pub pages: usize,
    pub bytes: u64,
    /// Images re-encoded by compression.
    pub images: usize,
    /// Areas redacted.
    pub redacted: usize,
    /// Positions of redacted pages whose content couldn't be taken apart; they
    /// must be saved again with a picture of the page (`PageRef::raster`).
    pub raster_needed: Vec<usize>,
}

/// What building the document did beyond arranging pages.
#[derive(Default)]
struct Report {
    redacted: usize,
    raster_needed: Vec<usize>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub pages: u32,
    pub bytes: u64,
    pub version: String,
    /// Opening it needs a password the caller did not give (or gave wrong).
    pub needs_password: bool,
    /// The file on disk is encrypted (with or without a user password).
    pub encrypted: bool,
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
}

fn load_options(password: Option<&str>) -> LoadOptions {
    LoadOptions {
        password: password.filter(|p| !p.is_empty()).map(str::to_string),
        max_decompressed_size: Some(MAX_DECOMPRESSED),
        ..Default::default()
    }
}

/// Loads and, when needed, decrypts a PDF. Fails with a readable message when
/// the password is missing or wrong.
pub fn load(path: &Path, password: Option<&str>) -> AppResult<Document> {
    let doc = match Document::load_with_options(path, load_options(password)) {
        Ok(doc) => doc,
        Err(lopdf::Error::InvalidPassword) => return Err(AppError::msg(format!("Wrong password for {}", file_name(path)))),
        Err(e) => return Err(AppError::msg(format!("Couldn't read {}: {e}", file_name(path)))),
    };
    if doc.is_encrypted() {
        return Err(AppError::msg(format!("{} is password protected", file_name(path))));
    }
    Ok(doc)
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

pub fn info(path: &Path, password: Option<&str>) -> AppResult<PdfInfo> {
    let bytes = std::fs::metadata(path)?.len();
    let doc = match Document::load_with_options(path, load_options(password)) {
        Ok(doc) => doc,
        Err(lopdf::Error::InvalidPassword) => {
            return Ok(PdfInfo { bytes, needs_password: true, encrypted: true, ..PdfInfo::empty() });
        }
        Err(e) => return Err(AppError::msg(format!("Couldn't read {}: {e}", file_name(path)))),
    };
    let needs_password = doc.is_encrypted();
    let mut out = PdfInfo {
        pages: doc.get_pages().len() as u32,
        bytes,
        version: doc.version.clone(),
        needs_password,
        encrypted: needs_password || doc.was_encrypted(),
        ..PdfInfo::empty()
    };
    if needs_password {
        return Ok(out);
    }
    if let Ok(info) = doc.trailer.get(b"Info").and_then(|o| doc.dereference(o)).and_then(|(_, o)| o.as_dict()) {
        let text = |key: &[u8]| info.get(key).ok().and_then(|o| text_string(&doc, o));
        out.title = text(b"Title");
        out.author = text(b"Author");
        out.subject = text(b"Subject");
        out.keywords = text(b"Keywords");
        out.creator = text(b"Creator");
        out.producer = text(b"Producer");
        out.created = text(b"CreationDate");
        out.modified = text(b"ModDate");
    }
    Ok(out)
}

impl PdfInfo {
    fn empty() -> Self {
        PdfInfo {
            pages: 0,
            bytes: 0,
            version: String::new(),
            needs_password: false,
            encrypted: false,
            title: None,
            author: None,
            subject: None,
            keywords: None,
            creator: None,
            producer: None,
            created: None,
            modified: None,
        }
    }
}

/// A PDF text string: UTF-16BE with a byte order mark, or PDFDocEncoding
/// (read as Latin-1, which matches it for printable characters).
pub(crate) fn text_string(doc: &Document, obj: &Object) -> Option<String> {
    let (_, obj) = doc.dereference(obj).ok()?;
    let bytes = obj.as_str().ok()?;
    let s = if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..].as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect();
        String::from_utf16_lossy(&units)
    } else {
        bytes.iter().map(|&b| b as char).collect()
    };
    let s = s.trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Builds a new PDF from `job.pages` and writes it to `job.output`.
pub fn assemble(job: &AssembleJob) -> AppResult<AssembleResult> {
    let output = PathBuf::from(&job.output);
    if !has_extension(&output, &["pdf"]) {
        return Err(AppError::msg("The output file must end in .pdf"));
    }
    let (mut doc, report) = build(&job.sources, &job.pages, job.outline.as_deref())?;
    let images = finish(&mut doc, &job.options, report.redacted)?;
    let bytes = save(&mut doc, &output, job.options.compress.is_some())?;
    Ok(AssembleResult { pages: job.pages.len(), bytes, images, redacted: report.redacted, raster_needed: report.raster_needed })
}

pub fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| allowed.iter().any(|a| e.eq_ignore_ascii_case(a)))
}

/// Merges the used sources into the first page's document and gives it a new
/// page tree holding exactly `pages`, in order.
fn build(sources: &[Source], pages: &[PageRef], bookmarks: Option<&[outline::Bookmark]>) -> AppResult<(Document, Report)> {
    let Some(first) = pages.first() else { return Err(AppError::msg("There are no pages to save")) };
    let by_id: HashMap<&str, &Source> = sources.iter().map(|s| (s.id.as_str(), s)).collect();
    let source = |id: &str| by_id.get(id).copied().ok_or_else(|| AppError::msg(format!("Unknown source {id}")));

    // Sources in order of first use; the first one is the base whose catalog
    // (bookmarks, form, metadata, viewer settings) the result keeps.
    let mut order: Vec<&str> = Vec::new();
    for p in pages {
        if !order.contains(&p.source.as_str()) {
            order.push(&p.source);
        }
    }
    let base_src = source(&first.source)?;
    let mut doc = load(Path::new(&base_src.path), base_src.password.as_deref())?;
    let mut page_ids: HashMap<&str, Vec<ObjectId>> = HashMap::new();
    page_ids.insert(&first.source, doc.get_pages().into_values().collect());
    let mut other_forms: Vec<Dictionary> = Vec::new();

    for id in order.iter().skip(1) {
        let src = source(id)?;
        let mut other = load(Path::new(&src.path), src.password.as_deref())?;
        other.renumber_objects_with(doc.max_id + 1);
        page_ids.insert(id, other.get_pages().into_values().collect());
        if let Some(form) = acro_form(&other) {
            other_forms.push(form);
        }
        doc.max_id = doc.max_id.max(other.max_id);
        doc.objects.extend(other.objects);
    }

    let catalog_id = doc.trailer.get(b"Root").and_then(Object::as_reference)?;
    let pages_id = doc.new_object_id();
    let mut kids: Vec<Object> = Vec::with_capacity(pages.len());
    let mut used: HashSet<ObjectId> = HashSet::new();
    let mut moved_annots: HashSet<ObjectId> = HashSet::new();
    let mut report = Report::default();
    let mut removed_annots: HashSet<ObjectId> = HashSet::new();
    for (position, p) in pages.iter().enumerate() {
        let ids = &page_ids[p.source.as_str()];
        let Some(&orig) = ids.get(p.index as usize) else {
            return Err(AppError::msg(format!(
                "Page {} does not exist in {}",
                p.index + 1,
                file_name(Path::new(&source(&p.source)?.path))
            )));
        };
        let mut dict = flattened_page(&doc, orig)?;
        let rotation = (dict.get(b"Rotate").and_then(Object::as_i64).unwrap_or(0) + p.rotate).rem_euclid(360);
        dict.set("Rotate", rotation - rotation % 90);
        dict.set("Parent", pages_id);
        // A page used twice becomes a second page object sharing the same content.
        let id = if used.insert(orig) { orig } else { doc.new_object_id() };
        if let Some(threads) = &p.comments {
            comments::write(&mut doc, &mut dict, id, threads)?;
        }
        if let Some(picture) = &p.raster {
            redact::rasterize(&mut doc, &mut dict, Path::new(picture))?;
        }
        if !p.redact.is_empty() {
            let outcome = redact::apply(&mut doc, &mut dict, &p.redact, p.raster.is_none())?;
            removed_annots.extend(outcome.removed);
            if outcome.issue.is_some() {
                report.raster_needed.push(position);
            }
            report.redacted += p.redact.len();
        }
        // After the comments, so they move with the content.
        if let Some(paper) = &p.sheet {
            sheet::fit_page(&mut doc, &mut dict, paper, &mut moved_annots)?;
        }
        doc.objects.insert(id, Object::Dictionary(dict));
        kids.push(id.into());
    }

    let kids_ids: Vec<ObjectId> = kids.iter().filter_map(|k| k.as_reference().ok()).collect();
    let mut tree = Dictionary::new();
    tree.set("Type", "Pages");
    tree.set("Count", kids.len() as i64);
    tree.set("Kids", kids);
    doc.objects.insert(pages_id, Object::Dictionary(tree));
    doc.get_dictionary_mut(catalog_id)?.set("Pages", pages_id);

    // Pages that were left out stay reachable through bookmarks, link
    // destinations or the structure tree; cut those links so the pages (and
    // their content) are dropped instead of bloating the file.
    let dropped: HashSet<ObjectId> = page_ids.values().flatten().copied().filter(|id| !used.contains(id)).collect();
    if !dropped.is_empty() {
        for (id, obj) in doc.objects.iter_mut() {
            if !dropped.contains(id) {
                null_references(obj, &dropped);
            }
        }
    }
    merge_forms(&mut doc, catalog_id, other_forms)?;
    if !removed_annots.is_empty() {
        redact::prune_fields(&mut doc, catalog_id, &removed_annots)?;
    }
    if let Some(items) = bookmarks {
        let page_objects: Vec<ObjectId> = kids_ids;
        outline::write(&mut doc, catalog_id, &page_objects, items)?;
    }
    doc.prune_objects();
    Ok((doc, report))
}

/// The page dictionary with inherited attributes copied onto it, so it can be
/// moved under a new parent.
pub(crate) fn flattened_page(doc: &Document, id: ObjectId) -> AppResult<Dictionary> {
    let mut dict = doc.get_dictionary(id)?.clone();
    let mut parent = dict.get(b"Parent").and_then(Object::as_reference).ok();
    let mut seen = HashSet::new();
    while let Some(pid) = parent {
        if !seen.insert(pid) {
            break;
        }
        let Ok(node) = doc.get_dictionary(pid) else { break };
        for key in INHERITABLE {
            if !dict.has(key)
                && let Ok(value) = node.get(key)
            {
                dict.set(key.to_vec(), value.clone());
            }
        }
        parent = node.get(b"Parent").and_then(Object::as_reference).ok();
    }
    // A page without a media box is malformed; US Letter is the conventional fallback.
    if !dict.has(b"MediaBox") {
        dict.set("MediaBox", vec![0.into(), 0.into(), 612.into(), 792.into()]);
    }
    Ok(dict)
}

fn null_references(obj: &mut Object, dropped: &HashSet<ObjectId>) {
    match obj {
        Object::Reference(id) if dropped.contains(id) => *obj = Object::Null,
        Object::Array(items) => items.iter_mut().for_each(|o| null_references(o, dropped)),
        Object::Dictionary(dict) => dict.iter_mut().for_each(|(_, o)| null_references(o, dropped)),
        Object::Stream(stream) => stream.dict.iter_mut().for_each(|(_, o)| null_references(o, dropped)),
        _ => {}
    }
}

fn acro_form(doc: &Document) -> Option<Dictionary> {
    let catalog = doc.catalog().ok()?;
    let (_, form) = doc.dereference(catalog.get(b"AcroForm").ok()?).ok()?;
    form.as_dict().ok().cloned()
}

/// Keeps the form fields of every merged file fillable by listing them in the
/// base document's form.
fn merge_forms(doc: &mut Document, catalog_id: ObjectId, others: Vec<Dictionary>) -> AppResult<()> {
    if others.is_empty() {
        return Ok(());
    }
    let mut form = acro_form(doc).unwrap_or_default();
    let mut fields = match form.get(b"Fields").map(|o| doc.dereference(o)) {
        Ok(Ok((_, Object::Array(a)))) => a.clone(),
        _ => Vec::new(),
    };
    for other in &others {
        if let Ok(Object::Array(more)) = other.get(b"Fields").map(|o| doc.dereference(o).map(|(_, o)| o.clone()).unwrap_or(Object::Null)) {
            fields.extend(more);
        }
        for key in [b"DR".as_slice(), b"DA"] {
            if !form.has(key)
                && let Ok(v) = other.get(key)
            {
                form.set(key.to_vec(), v.clone());
            }
        }
    }
    form.set("Fields", fields);
    let form_id = doc.add_object(form);
    doc.get_dictionary_mut(catalog_id)?.set("AcroForm", form_id);
    Ok(())
}

/// Applies the save options; returns how many images compression re-encoded.
fn finish(doc: &mut Document, options: &Options, redacted: usize) -> AppResult<usize> {
    if options.strip_metadata {
        strip_metadata(doc)?;
    }
    if redacted > 0 {
        note_redaction(doc, redacted)?;
    }
    let images = match options.compress {
        Some(level) => compress::run(doc, level),
        None => 0,
    };
    // Flate-compresses streams that were stored uncompressed: lossless and cheap.
    doc.compress();
    doc.renumber_objects();
    if let Some(protect) = &options.protect {
        encrypt(doc, protect)?;
    }
    Ok(images)
}

/// Says in the document information that content was removed, so a reader
/// can tell the black boxes are redactions and not part of the original.
fn note_redaction(doc: &mut Document, areas: usize) -> AppResult<()> {
    let note = format!(
        "Some parts of this file were blacked out with KlikPaper {} on {}: what was under the {areas} black box{} was deleted, so the boxes are not part of the original.",
        env!("CARGO_PKG_VERSION"),
        today(),
        if areas == 1 { "" } else { "es" }
    );
    let mut info = match doc.trailer.get(b"Info").and_then(|o| doc.dereference(o)).and_then(|(_, o)| o.as_dict()) {
        Ok(d) => d.clone(),
        Err(_) => Dictionary::new(),
    };
    info.set("Redacted", comments::text_object(&note));
    let id = doc.add_object(info);
    doc.trailer.set("Info", id);
    Ok(())
}

/// Today's date (UTC) as YYYY-MM-DD.
fn today() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Days to a civil date (Howard Hinnant's algorithm).
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn strip_metadata(doc: &mut Document) -> AppResult<()> {
    doc.trailer.remove(b"Info");
    let catalog_id = doc.trailer.get(b"Root").and_then(Object::as_reference)?;
    let catalog = doc.get_dictionary_mut(catalog_id)?;
    catalog.remove(b"Metadata");
    catalog.remove(b"PieceInfo");
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for id in pages {
        if let Ok(page) = doc.get_dictionary_mut(id) {
            page.remove(b"Metadata");
            page.remove(b"PieceInfo");
        }
    }
    doc.prune_objects();
    Ok(())
}

/// AES-256 (PDF 2.0 security handler, revision 6). Printing and copying stay allowed.
fn encrypt(doc: &mut Document, protect: &Protect) -> AppResult<()> {
    if protect.user_password.is_empty() {
        return Err(AppError::msg("The password can't be empty"));
    }
    let owner = protect.owner_password.as_deref().filter(|p| !p.is_empty()).unwrap_or(&protect.user_password);
    let mut key = [0u8; 32];
    key[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    key[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    let filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
    let version = EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
        file_encryption_key: &key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: owner,
        user_password: &protect.user_password,
        permissions: Permissions::PRINTABLE
            | Permissions::PRINTABLE_IN_HIGH_QUALITY
            | Permissions::COPYABLE
            | Permissions::COPYABLE_FOR_ACCESSIBILITY,
    };
    let state = EncryptionState::try_from(version).map_err(|e| AppError::msg(format!("Couldn't encrypt: {e}")))?;
    // Revision 6 belongs to PDF 2.0; 1.7 readers know it as Adobe extension level 8.
    if doc.version.as_str() < "1.7" {
        doc.version = "1.7".into();
    }
    if doc.version.as_str() < "2.0" {
        let catalog_id = doc.trailer.get(b"Root").and_then(Object::as_reference)?;
        let mut adbe = Dictionary::new();
        adbe.set("BaseVersion", Object::Name(b"1.7".to_vec()));
        adbe.set("ExtensionLevel", 8);
        let mut ext = Dictionary::new();
        ext.set("ADBE", adbe);
        doc.get_dictionary_mut(catalog_id)?.set("Extensions", ext);
    }
    if doc.trailer.get(b"ID").is_err() {
        let id = Object::String(uuid::Uuid::new_v4().as_bytes().to_vec(), lopdf::StringFormat::Hexadecimal);
        doc.trailer.set("ID", vec![id.clone(), id]);
    }
    doc.encrypt(&state)?;
    Ok(())
}

/// Writes next to the target and renames, so saving over the open file never
/// leaves it half-written. Returns the file size.
pub fn save(doc: &mut Document, output: &Path, object_streams: bool) -> AppResult<u64> {
    let dir = output.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let tmp = dir.join(format!(".{}.klikpaper-{}.tmp", file_name(output), uuid::Uuid::new_v4().simple()));
    let result = (|| -> AppResult<()> {
        let mut file = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        if object_streams && !doc.is_encrypted() {
            doc.save_modern(&mut file)?;
        } else {
            doc.save_to(&mut file)?;
        }
        use std::io::Write;
        file.flush()?;
        drop(file);
        std::fs::rename(&tmp, output)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    Ok(std::fs::metadata(output)?.len())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{Stream, dictionary};

    /// A small PDF whose pages each print their label; one page tree level deep
    /// with the media box inherited, plus a bookmark to the last page.
    pub fn sample(labels: &[&str]) -> Document {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let mut kids = Vec::new();
        for label in labels {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 24.into()]),
                    Operation::new("Td", vec![72.into(), 720.into()]),
                    Operation::new("Tj", vec![Object::string_literal(*label)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Contents" => content_id,
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
            });
            kids.push(Object::Reference(page));
        }
        let last = kids.last().cloned().unwrap();
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids.clone(),
                "Count" => kids.len() as i64,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            }),
        );
        let outline_item = doc.new_object_id();
        let outlines = doc.add_object(dictionary! { "Type" => "Outlines", "First" => outline_item, "Last" => outline_item, "Count" => 1 });
        doc.objects.insert(
            outline_item,
            Object::Dictionary(dictionary! {
                "Title" => Object::string_literal("Last page"),
                "Parent" => outlines,
                "Dest" => vec![last, "Fit".into()],
            }),
        );
        let info =
            doc.add_object(dictionary! { "Title" => Object::string_literal("Sample"), "Author" => Object::string_literal("Tester") });
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id, "Outlines" => outlines });
        doc.trailer.set("Root", catalog);
        doc.trailer.set("Info", info);
        doc
    }

    pub fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("klikpaper-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn write_sample(dir: &Path, name: &str, labels: &[&str]) -> String {
        let path = dir.join(name);
        sample(labels).save(&path).unwrap();
        path.display().to_string()
    }

    /// The label each page prints, in order.
    pub fn labels(doc: &Document) -> Vec<String> {
        doc.get_pages()
            .into_values()
            .map(|id| {
                let content = Content::decode(&doc.get_page_content(id)).unwrap();
                let tj = content.operations.iter().find(|op| op.operator == "Tj").unwrap();
                String::from_utf8_lossy(tj.operands[0].as_str().unwrap()).into_owned()
            })
            .collect()
    }

    fn page(source: &str, index: u32, rotate: i64) -> PageRef {
        PageRef { source: source.into(), index, rotate, sheet: None, comments: None, redact: Vec::new(), raster: None }
    }

    fn src(id: &str, path: &str) -> Source {
        Source { id: id.into(), path: path.into(), password: None }
    }

    #[test]
    fn merges_reorders_and_rotates() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2", "A3"]);
        let b = write_sample(&dir, "b.pdf", &["B1", "B2"]);
        let out = dir.join("out.pdf").display().to_string();
        let job = AssembleJob {
            sources: vec![src("a", &a), src("b", &b)],
            pages: vec![page("b", 1, 0), page("a", 0, 90), page("a", 2, -90), page("b", 0, 0)],
            output: out.clone(),
            options: Options::default(),
            outline: None,
        };
        let res = assemble(&job).unwrap();
        assert_eq!(res.pages, 4);
        let doc = Document::load(&out).unwrap();
        assert_eq!(labels(&doc), ["B2", "A1", "A3", "B1"]);
        let rotations: Vec<i64> =
            doc.get_pages().values().map(|id| doc.get_dictionary(*id).unwrap().get(b"Rotate").unwrap().as_i64().unwrap()).collect();
        assert_eq!(rotations, [0, 90, 270, 0]);
        // The inherited media box was copied onto every page.
        assert!(doc.get_pages().values().all(|id| doc.get_dictionary(*id).unwrap().has(b"MediaBox")));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn fits_pages_onto_another_paper_size() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2"]);
        let out = dir.join("a4.pdf").display().to_string();
        let a4 = sheet::Sheet { w: 595.28, h: 841.89, margin: 0.0 };
        let job = AssembleJob {
            sources: vec![src("a", &a)],
            pages: vec![PageRef { sheet: Some(a4), ..page("a", 0, 0) }, page("a", 1, 0)],
            output: out.clone(),
            options: Options::default(),
            outline: None,
        };
        assemble(&job).unwrap();
        let doc = Document::load(&out).unwrap();
        let boxes: Vec<Vec<f64>> = doc
            .get_pages()
            .values()
            .map(|id| {
                let d = doc.get_dictionary(*id).unwrap();
                d.get(b"MediaBox")
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|o| o.as_float().map(f64::from).or(o.as_i64().map(|i| i as f64)).unwrap())
                    .collect()
            })
            .collect();
        assert!((boxes[0][2] - 595.28).abs() < 0.01 && (boxes[0][3] - 841.89).abs() < 0.01);
        assert_eq!(boxes[1], [0.0, 0.0, 612.0, 792.0]);
        // The resized page draws its old content, now a form, through a scaling transform.
        let first = *doc.get_pages().values().next().unwrap();
        let content = String::from_utf8_lossy(&doc.get_page_content(first)).into_owned();
        assert!(content.starts_with("q 0.97") && content.contains(" cm /KlikPaperPage Do Q"));
        let page = doc.get_dictionary(first).unwrap();
        let xobjects = page.get(b"Resources").unwrap().as_dict().unwrap().get(b"XObject").unwrap().as_dict().unwrap();
        let form = doc.get_object(xobjects.get(b"KlikPaperPage").unwrap().as_reference().unwrap()).unwrap().as_stream().unwrap();
        let text = String::from_utf8_lossy(&form.decompressed_content().unwrap_or_else(|_| form.content.clone())).into_owned();
        assert!(text.contains("(A1) Tj"));
        assert!(form.dict.get(b"Resources").unwrap().as_dict().unwrap().has(b"Font"));
        // The other page is untouched.
        let second = *doc.get_pages().values().nth(1).unwrap();
        assert!(String::from_utf8_lossy(&doc.get_page_content(second)).contains("(A2) Tj"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn extracting_drops_left_out_pages_and_their_bookmarks() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2", "A3"]);
        let out = dir.join("one.pdf").display().to_string();
        let job = AssembleJob {
            sources: vec![src("a", &a)],
            pages: vec![page("a", 0, 0)],
            output: out.clone(),
            options: Options::default(),
            outline: None,
        };
        assemble(&job).unwrap();
        let doc = Document::load(&out).unwrap();
        assert_eq!(labels(&doc), ["A1"]);
        // The bookmark pointed at A3; its destination is cut so A3's content is gone.
        let page_objects = doc.objects.values().filter(|o| o.as_dict().is_ok_and(|d| d.has_type(b"Page"))).count();
        assert_eq!(page_objects, 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_page_can_be_used_twice() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2"]);
        let out = dir.join("dup.pdf").display().to_string();
        let job = AssembleJob {
            sources: vec![src("a", &a)],
            pages: vec![page("a", 1, 0), page("a", 1, 90)],
            output: out.clone(),
            options: Options::default(),
            outline: None,
        };
        assemble(&job).unwrap();
        assert_eq!(labels(&Document::load(&out).unwrap()), ["A2", "A2"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn protects_with_a_password_and_strips_metadata() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2"]);
        let out = dir.join("locked.pdf");
        let job = AssembleJob {
            sources: vec![src("a", &a)],
            pages: vec![page("a", 0, 0), page("a", 1, 0)],
            output: out.display().to_string(),
            options: Options {
                strip_metadata: true,
                compress: None,
                protect: Some(Protect { user_password: "rahasia".into(), owner_password: None }),
            },
            outline: None,
        };
        assemble(&job).unwrap();
        let locked = info(&out, None).unwrap();
        assert!(locked.needs_password && locked.encrypted);
        assert!(load(&out, Some("salah")).unwrap_err().to_string().contains("Wrong password"));
        let doc = load(&out, Some("rahasia")).unwrap();
        assert_eq!(labels(&doc), ["A1", "A2"]);
        let opened = info(&out, Some("rahasia")).unwrap();
        assert!(!opened.needs_password && opened.encrypted);
        assert_eq!(opened.title, None);

        // Saving the opened file without protection removes the password.
        let open = dir.join("open.pdf");
        let job = AssembleJob {
            sources: vec![Source { id: "l".into(), path: out.display().to_string(), password: Some("rahasia".into()) }],
            pages: vec![page("l", 0, 0)],
            output: open.display().to_string(),
            options: Options::default(),
            outline: None,
        };
        assemble(&job).unwrap();
        assert!(!info(&open, None).unwrap().encrypted);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reads_document_info() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2", "A3"]);
        let i = info(Path::new(&a), None).unwrap();
        assert_eq!(i.pages, 3);
        assert_eq!(i.title.as_deref(), Some("Sample"));
        assert_eq!(i.author.as_deref(), Some("Tester"));
        assert!(!i.encrypted);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_non_pdf_outputs_and_bad_pages() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1"]);
        let job = |output: &str, index| AssembleJob {
            sources: vec![src("a", &a)],
            pages: vec![page("a", index, 0)],
            output: dir.join(output).display().to_string(),
            options: Options::default(),
            outline: None,
        };
        assert!(assemble(&job("evil.sh", 0)).is_err());
        assert!(assemble(&job("ok.pdf", 5)).unwrap_err().to_string().contains("Page 6"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
