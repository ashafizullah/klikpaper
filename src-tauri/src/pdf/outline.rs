//! Bookmarks (the document outline). When the user edited them, or merged
//! files that each had their own, the outline is written fresh from the list
//! KlikPaper keeps; otherwise the base file's outline is kept as it was.
use super::comments::text_object;
use super::sheet::visible_box;
use crate::error::AppResult;
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Deserialize;

/// Nesting deeper than this is cut off (a crafted list can't recurse without end).
const MAX_DEPTH: usize = 64;

#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub title: String,
    /// 0-based position of the target page in the output; None for a heading that goes nowhere.
    #[serde(default)]
    pub page: Option<usize>,
    /// Where on the page to go, in points from its top (unrotated); None shows the whole page.
    #[serde(default)]
    pub y: Option<f64>,
    /// A web link instead of a page.
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// RGB, each from 0 to 1.
    #[serde(default)]
    pub color: Option<[f64; 3]>,
    /// Shown with its children unfolded.
    #[serde(default)]
    pub open: bool,
    #[serde(default)]
    pub children: Vec<Bookmark>,
}

/// Replaces the document's outline with `items`; `pages` are the output's page objects in order.
pub fn write(doc: &mut Document, catalog_id: ObjectId, pages: &[ObjectId], items: &[Bookmark]) -> AppResult<()> {
    if items.is_empty() {
        doc.get_dictionary_mut(catalog_id)?.remove(b"Outlines");
        return Ok(());
    }
    let root = doc.new_object_id();
    let (first, last, count) = level(doc, root, pages, items, 0);
    let mut dict = Dictionary::new();
    dict.set("Type", "Outlines");
    dict.set("First", first);
    dict.set("Last", last);
    dict.set("Count", count);
    doc.objects.insert(root, Object::Dictionary(dict));
    doc.get_dictionary_mut(catalog_id)?.set("Outlines", root);
    Ok(())
}

/// Writes one level of items under `parent`; returns its first and last item
/// and how many items show when the level is unfolded.
fn level(doc: &mut Document, parent: ObjectId, pages: &[ObjectId], items: &[Bookmark], depth: usize) -> (ObjectId, ObjectId, i64) {
    let ids: Vec<ObjectId> = items.iter().map(|_| doc.new_object_id()).collect();
    let mut shown = 0;
    for (i, b) in items.iter().enumerate() {
        let mut dict = Dictionary::new();
        dict.set("Title", text_object(b.title.trim()));
        dict.set("Parent", parent);
        if i > 0 {
            dict.set("Prev", ids[i - 1]);
        }
        if let Some(next) = ids.get(i + 1) {
            dict.set("Next", *next);
        }
        if let Some(&page) = b.page.and_then(|p| pages.get(p)) {
            let top = b.y.zip(doc.get_dictionary(page).ok().and_then(visible_box)).map(|(y, bx)| bx[3] - y);
            dict.set(
                "Dest",
                match top {
                    Some(top) => vec![page.into(), "XYZ".into(), Object::Null, Object::Real(top as f32), Object::Null],
                    None => vec![page.into(), "Fit".into()],
                },
            );
        } else if let Some(url) = b.url.as_deref().filter(|u| !u.is_empty()) {
            let mut action = Dictionary::new();
            action.set("S", "URI");
            action.set("URI", Object::string_literal(url));
            dict.set("A", action);
        }
        let flags = i64::from(b.italic) | (i64::from(b.bold) << 1);
        if flags != 0 {
            dict.set("F", flags);
        }
        if let Some(c) = b.color.filter(|c| c.iter().any(|v| *v > 0.0)) {
            dict.set("C", c.iter().map(|v| Object::Real(v.clamp(0.0, 1.0) as f32)).collect::<Vec<_>>());
        }
        shown += 1;
        if !b.children.is_empty() && depth < MAX_DEPTH {
            let (first, last, below) = level(doc, ids[i], pages, &b.children, depth + 1);
            dict.set("First", first);
            dict.set("Last", last);
            // Positive: unfolded, with this many items showing; negative: folded.
            dict.set("Count", if b.open { below } else { -below });
            if b.open {
                shown += below;
            }
        }
        doc.objects.insert(ids[i], Object::Dictionary(dict));
    }
    (ids[0], *ids.last().unwrap(), shown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::tests::{sample, temp_dir, write_sample};
    use crate::pdf::{AssembleJob, Options, PageRef, Source, assemble};

    fn bookmark(title: &str, page: Option<usize>, children: Vec<Bookmark>) -> Bookmark {
        Bookmark { title: title.into(), page, open: true, children, ..Default::default() }
    }

    fn titles(doc: &Document, first: Option<ObjectId>) -> Vec<(String, Option<ObjectId>, Vec<String>)> {
        let mut out = Vec::new();
        let mut at = first;
        while let Some(id) = at {
            let d = doc.get_dictionary(id).unwrap();
            let title = crate::pdf::text_string(doc, d.get(b"Title").unwrap()).unwrap_or_default();
            let page = d.get(b"Dest").and_then(Object::as_array).ok().and_then(|a| a[0].as_reference().ok());
            let kids = titles(doc, d.get(b"First").and_then(Object::as_reference).ok()).into_iter().map(|k| k.0).collect();
            out.push((title, page, kids));
            at = d.get(b"Next").and_then(Object::as_reference).ok();
        }
        out
    }

    #[test]
    fn writes_a_nested_outline_pointing_at_the_output_pages() {
        let dir = temp_dir();
        let a = write_sample(&dir, "a.pdf", &["A1", "A2", "A3"]);
        let out = dir.join("out.pdf").display().to_string();
        let outline = vec![
            bookmark("Pembukaan", Some(1), vec![bookmark("Bagian 1.1 ✓", Some(0), vec![])]),
            Bookmark { title: "Web".into(), url: Some("https://example.com".into()), ..Default::default() },
        ];
        let page = |index| PageRef {
            source: "a".into(),
            index,
            rotate: 0,
            sheet: None,
            comments: None,
            redact: Vec::new(),
            raster: None,
            ocr: None,
        };
        let job = AssembleJob {
            sources: vec![Source { id: "a".into(), path: a, password: None }],
            pages: vec![page(2), page(0)],
            output: out.clone(),
            options: Options::default(),
            outline: Some(outline),
        };
        assemble(&job).unwrap();
        let doc = Document::load(&out).unwrap();
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        let root = doc.catalog().unwrap().get(b"Outlines").unwrap().as_reference().unwrap();
        let root = doc.get_dictionary(root).unwrap();
        assert_eq!(root.get(b"Count").unwrap().as_i64().unwrap(), 3);
        let got = titles(&doc, root.get(b"First").and_then(Object::as_reference).ok());
        assert_eq!(got[0], ("Pembukaan".to_string(), Some(pages[1]), vec!["Bagian 1.1 ✓".to_string()]));
        assert_eq!((got[1].0.as_str(), got[1].1), ("Web", None));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_empty_list_removes_the_outline() {
        let mut doc = sample(&["A"]);
        let catalog = doc.trailer.get(b"Root").and_then(Object::as_reference).unwrap();
        write(&mut doc, catalog, &[], &[]).unwrap();
        assert!(doc.catalog().unwrap().get(b"Outlines").is_err());
    }
}
