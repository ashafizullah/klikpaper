//! Comments, the standard PDF way so Acrobat, Preview and other readers show
//! them too: a thread is a sticky note (a Text annotation) plus the notes that
//! answer it (/IRT, "in reply to"). "Resolved" is Acrobat's review state: a
//! hidden reply with /StateModel /Review. Notes that answer something other
//! than a note (say, a highlight made in Acrobat) are left as they are.
use super::{sheet, text_string};
use crate::error::AppResult;
use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// The note's icon, in points.
const ICON: f64 = 20.0;
/// Print, no zoom, no rotate: how Acrobat flags its notes.
const FLAGS: i64 = 4 | 8 | 16;
/// The same, hidden: review states are not drawn.
const HIDDEN: i64 = FLAGS | 2;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: String,
    pub author: String,
    /// ISO 8601; empty when unknown.
    pub date: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    /// Where the note sits: points from the visible page's top-left corner (unrotated, y down).
    pub x: f64,
    pub y: f64,
    pub author: String,
    pub date: String,
    pub text: String,
    #[serde(default)]
    pub replies: Vec<Reply>,
    #[serde(default)]
    pub resolved: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageThreads {
    /// 0-based page index.
    pub index: u32,
    pub threads: Vec<Thread>,
}

fn annot_refs(doc: &Document, page: &Dictionary) -> Vec<ObjectId> {
    let items = match page.get(b"Annots") {
        Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
        Ok(Object::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    items.iter().filter_map(|o| o.as_reference().ok()).collect()
}

fn is_note(dict: &Dictionary) -> bool {
    dict.get(b"Subtype").and_then(Object::as_name).is_ok_and(|n| n == b"Text")
}

fn irt(dict: &Dictionary) -> Option<ObjectId> {
    dict.get(b"IRT").and_then(Object::as_reference).ok()
}

/// The page's notes that belong to a thread, each with the thread's first note.
fn threaded(doc: &Document, annots: &[ObjectId]) -> HashMap<ObjectId, ObjectId> {
    let notes: HashMap<ObjectId, Option<ObjectId>> =
        annots.iter().filter_map(|id| doc.get_dictionary(*id).ok().filter(|d| is_note(d)).map(|d| (*id, irt(d)))).collect();
    let mut out = HashMap::new();
    for &id in notes.keys() {
        let mut at = id;
        // A few steps at most; a loop of replies is broken, not followed.
        for _ in 0..32 {
            match notes.get(&at) {
                Some(None) => {
                    out.insert(id, at);
                    break;
                }
                Some(Some(parent)) => at = *parent,
                None => break,
            }
        }
    }
    out
}

/// A PDF date (D:YYYYMMDDHHmmSS+HH'mm') as ISO 8601; empty when unreadable.
pub fn pdf_date_to_iso(s: &str) -> String {
    let s = s.trim().trim_start_matches("D:");
    let digits: String = s.chars().take_while(char::is_ascii_digit).collect();
    if digits.len() < 4 {
        return String::new();
    }
    let part = |from: usize, default: &str| digits.get(from..from + 2).unwrap_or(default).to_string();
    let (y, mo, d, h, mi, se) = (&digits[..4], part(4, "01"), part(6, "01"), part(8, "00"), part(10, "00"), part(12, "00"));
    let rest = &s[digits.len()..];
    let tz = match rest.chars().next() {
        Some('Z') => "Z".to_string(),
        Some(sign @ ('+' | '-')) => {
            let tz: String = rest[1..].chars().filter(char::is_ascii_digit).collect();
            let hh = tz.get(..2).unwrap_or("00");
            let mm = tz.get(2..4).unwrap_or("00");
            format!("{sign}{hh}:{mm}")
        }
        _ => String::new(),
    };
    format!("{y}-{mo}-{d}T{h}:{mi}:{se}{tz}")
}

/// An ISO 8601 date as a PDF date; None when unreadable.
pub fn iso_to_pdf_date(s: &str) -> Option<String> {
    let (date, time) = s.trim().split_once('T')?;
    let digits: String = date.chars().filter(char::is_ascii_digit).collect();
    let clock: String = time.chars().take_while(|c| c.is_ascii_digit() || *c == ':').filter(char::is_ascii_digit).collect();
    if digits.len() != 8 || clock.len() < 4 {
        return None;
    }
    let clock = format!("{clock:0<6}");
    let tz = time.trim_start_matches(|c: char| c.is_ascii_digit() || c == ':' || c == '.');
    let tz = match tz.chars().next() {
        Some('Z') => "Z".to_string(),
        Some(sign @ ('+' | '-')) => {
            let tz: String = tz[1..].chars().filter(char::is_ascii_digit).collect();
            format!("{sign}{}'{}'", tz.get(..2).unwrap_or("00"), tz.get(2..4).unwrap_or("00"))
        }
        _ => String::new(),
    };
    Some(format!("D:{digits}{}{tz}", &clock[..6]))
}

/// A text string: plain when it is printable ASCII, else UTF-16 with a byte order mark.
fn text_object(s: &str) -> Object {
    if s.chars().all(|c| c == '\n' || (' '..='~').contains(&c)) {
        return Object::String(s.as_bytes().to_vec(), StringFormat::Literal);
    }
    let mut bytes = vec![0xFE, 0xFF];
    for unit in s.encode_utf16() {
        bytes.extend(unit.to_be_bytes());
    }
    Object::String(bytes, StringFormat::Hexadecimal)
}

fn text(doc: &Document, dict: &Dictionary, key: &[u8]) -> String {
    dict.get(key).ok().and_then(|o| text_string(doc, o)).unwrap_or_default().replace("\r\n", "\n").replace('\r', "\n")
}

fn date(doc: &Document, dict: &Dictionary) -> String {
    let raw = text(doc, dict, b"M");
    let raw = if raw.is_empty() { text(doc, dict, b"CreationDate") } else { raw };
    pdf_date_to_iso(&raw)
}

fn name_of(doc: &Document, dict: &Dictionary, id: ObjectId) -> String {
    let nm = text(doc, dict, b"NM");
    if nm.is_empty() { format!("pdf-{}-{}", id.0, id.1) } else { nm }
}

fn number(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

/// The threads on one page (its dictionary with inherited attributes).
pub fn page_threads(doc: &Document, page: &Dictionary) -> Vec<Thread> {
    let Some(bx) = sheet::visible_box(page) else { return Vec::new() };
    let annots = annot_refs(doc, page);
    let roots = threaded(doc, &annots);
    let mut threads: Vec<(ObjectId, Thread)> = Vec::new();
    // Review states, latest last, per thread.
    let mut states: HashMap<ObjectId, Vec<(String, bool)>> = HashMap::new();
    for id in &annots {
        let Some(&root) = roots.get(id) else { continue };
        if *id != root {
            continue;
        }
        let Ok(dict) = doc.get_dictionary(*id) else { continue };
        let rect: Vec<f64> =
            dict.get(b"Rect").and_then(Object::as_array).map(|a| a.iter().filter_map(number).collect()).unwrap_or_default();
        let [a, b, c, d] = rect[..] else { continue };
        threads.push((
            root,
            Thread {
                id: name_of(doc, dict, *id),
                x: a.min(c) - bx[0],
                y: bx[3] - b.max(d),
                author: text(doc, dict, b"T"),
                date: date(doc, dict),
                text: text(doc, dict, b"Contents"),
                replies: Vec::new(),
                resolved: false,
            },
        ));
    }
    for id in &annots {
        let Some(&root) = roots.get(id) else { continue };
        let Ok(dict) = doc.get_dictionary(*id) else { continue };
        let Some((_, thread)) = threads.iter_mut().find(|(r, _)| *r == root) else { continue };
        if *id == root {
            continue;
        }
        if dict.has(b"StateModel") {
            let review = dict.get(b"StateModel").and_then(Object::as_name).is_ok_and(|n| n == b"Review");
            if review {
                let state = dict.get(b"State").and_then(Object::as_name).unwrap_or(b"None");
                states.entry(root).or_default().push((date(doc, dict), matches!(state, b"Completed" | b"Accepted")));
            }
            continue;
        }
        thread.replies.push(Reply {
            id: name_of(doc, dict, *id),
            author: text(doc, dict, b"T"),
            date: date(doc, dict),
            text: text(doc, dict, b"Contents"),
        });
    }
    let mut out = Vec::with_capacity(threads.len());
    for (root, mut thread) in threads {
        thread.replies.sort_by(|a, b| a.date.cmp(&b.date));
        if let Some(list) = states.get_mut(&root) {
            list.sort_by(|a, b| a.0.cmp(&b.0));
            thread.resolved = list.last().is_some_and(|s| s.1);
        }
        out.push(thread);
    }
    out
}

/// Every page's threads in a file (pages without any are left out).
pub fn read_file(path: &std::path::Path, password: Option<&str>) -> AppResult<Vec<PageThreads>> {
    Ok(read(&super::load(path, password)?))
}

fn read(doc: &Document) -> Vec<PageThreads> {
    doc.get_pages()
        .into_values()
        .enumerate()
        .filter_map(|(i, id)| {
            let page = super::flattened_page(doc, id).ok()?;
            let threads = page_threads(doc, &page);
            (!threads.is_empty()).then_some(PageThreads { index: i as u32, threads })
        })
        .collect()
}

fn note(page_id: ObjectId, rect: &[Object], author: &str, date: Option<&String>, id: &str, contents: &str) -> Dictionary {
    let mut d = Dictionary::new();
    d.set("Type", "Annot");
    d.set("Subtype", "Text");
    d.set("Rect", rect.to_vec());
    d.set("P", page_id);
    d.set("NM", text_object(id));
    d.set("T", text_object(author));
    d.set("Contents", text_object(contents));
    d.set("Name", "Comment");
    d.set("C", vec![Object::Real(1.0), Object::Real(0.82), Object::Real(0.2)]);
    d.set("F", FLAGS);
    if let Some(date) = date {
        d.set("M", text_object(date));
        d.set("CreationDate", text_object(date));
    }
    d
}

/// Replaces the threads on a page (a page dictionary about to be written as
/// `page_id`) with `threads`; the page's other annotations stay.
pub fn write(doc: &mut Document, page: &mut Dictionary, page_id: ObjectId, threads: &[Thread]) -> AppResult<()> {
    let annots = annot_refs(doc, page);
    let managed: HashSet<ObjectId> = threaded(doc, &annots).into_keys().collect();
    if managed.is_empty() && threads.is_empty() {
        return Ok(());
    }
    let Some(bx) = sheet::visible_box(page) else { return Ok(()) };
    let mut kept: Vec<Object> = annots.iter().filter(|id| !managed.contains(id)).map(|id| Object::Reference(*id)).collect();
    for t in threads {
        let (x, y) = (bx[0] + t.x, bx[3] - t.y);
        let rect = [x, y - ICON, x + ICON, y].map(|v| Object::Real(v as f32));
        let created = iso_to_pdf_date(&t.date);
        let root = doc.add_object(note(page_id, &rect, &t.author, created.as_ref(), &t.id, &t.text));
        kept.push(root.into());
        let mut answer = |doc: &mut Document, mut d: Dictionary| {
            d.set("IRT", root);
            d.set("RT", "R");
            kept.push(doc.add_object(d).into());
        };
        for r in &t.replies {
            answer(doc, note(page_id, &rect, &r.author, iso_to_pdf_date(&r.date).as_ref(), &r.id, &r.text));
        }
        if t.resolved {
            let mut d =
                note(page_id, &rect, &t.author, created.as_ref(), &format!("{}-state", t.id), &format!("Completed set by {}", t.author));
            d.set("StateModel", "Review");
            d.set("State", "Completed");
            d.set("F", HIDDEN);
            answer(doc, d);
        }
    }
    page.set("Annots", kept);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_dates() {
        assert_eq!(pdf_date_to_iso("D:20261027143005+07'00'"), "2026-10-27T14:30:05+07:00");
        assert_eq!(pdf_date_to_iso("D:20261027143005Z"), "2026-10-27T14:30:05Z");
        assert_eq!(pdf_date_to_iso("D:2026"), "2026-01-01T00:00:00");
        assert_eq!(pdf_date_to_iso("garbage"), "");
        assert_eq!(iso_to_pdf_date("2026-10-27T07:30:05.123Z").as_deref(), Some("D:20261027073005Z"));
        assert_eq!(iso_to_pdf_date("2026-10-27T14:30:05+07:00").as_deref(), Some("D:20261027143005+07'00'"));
        assert_eq!(iso_to_pdf_date("yesterday"), None);
    }

    #[test]
    fn writes_and_reads_threads() {
        let mut doc = crate::pdf::tests::sample(&["one"]);
        let page_id = *doc.get_pages().get(&1).unwrap();
        let mut page = crate::pdf::flattened_page(&doc, page_id).unwrap();
        // Someone else's highlight with a reply stays untouched.
        let highlight = doc.add_object(
            lopdf::dictionary! { "Type" => "Annot", "Subtype" => "Highlight", "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()] },
        );
        let answer = doc.add_object(lopdf::dictionary! { "Type" => "Annot", "Subtype" => "Text", "IRT" => highlight, "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()] });
        page.set("Annots", vec![Object::Reference(highlight), Object::Reference(answer)]);

        let thread = Thread {
            id: "c1".into(),
            x: 100.0,
            y: 50.0,
            author: "Adam".into(),
            date: "2026-10-27T07:30:00.000Z".into(),
            text: "Halaman ini perlu dicek ✓".into(),
            replies: vec![Reply { id: "r1".into(), author: "Budi".into(), date: "2026-10-27T08:00:00Z".into(), text: "Sudah".into() }],
            resolved: true,
        };
        write(&mut doc, &mut page, page_id, std::slice::from_ref(&thread)).unwrap();
        let back = page_threads(&doc, &page);
        assert_eq!(back.len(), 1);
        let got = &back[0];
        assert_eq!((got.id.as_str(), got.author.as_str(), got.text.as_str()), ("c1", "Adam", "Halaman ini perlu dicek ✓"));
        assert!((got.x - 100.0).abs() < 0.01 && (got.y - 50.0).abs() < 0.01);
        assert_eq!(got.date, "2026-10-27T07:30:00Z");
        assert_eq!(got.replies, thread.replies);
        assert!(got.resolved);
        assert_eq!(annot_refs(&doc, &page).len(), 2 + 3);

        // Writing again replaces the threads instead of adding to them.
        write(&mut doc, &mut page, page_id, &[]).unwrap();
        assert!(page_threads(&doc, &page).is_empty());
        assert_eq!(annot_refs(&doc, &page), vec![highlight, answer]);
    }
}
