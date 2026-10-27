//! Putting a page on another paper size (A4, Letter, ...): its content is
//! scaled to fit inside the margins, never stretched, and centered. The page's
//! content becomes a form XObject drawn through one transform (inside a form,
//! patterns and gradients follow that transform; on the page itself they would
//! stay put), and its annotations (links, form fields, highlights) move with it.
use crate::error::AppResult;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;
use std::collections::HashSet;

/// The paper, in points and in the page's own (unrotated) orientation.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub margin: f64,
}

/// Scale and offset that put a `[x0, y0, x1, y1]` box on the sheet.
pub fn fit(page: [f64; 4], sheet: &Sheet) -> (f64, f64, f64) {
    let (w, h) = (page[2] - page[0], page[3] - page[1]);
    let m = sheet.margin.clamp(0.0, sheet.w.min(sheet.h) / 3.0);
    let s = ((sheet.w - 2.0 * m) / w).min((sheet.h - 2.0 * m) / h);
    let ox = (sheet.w - w * s) / 2.0 - page[0] * s;
    let oy = (sheet.h - h * s) / 2.0 - page[1] * s;
    (s, ox, oy)
}

fn number(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

/// The visible box of a page dictionary (crop box, else media box), normalized.
fn visible_box(dict: &Dictionary) -> Option<[f64; 4]> {
    let arr = dict.get(b"CropBox").or_else(|_| dict.get(b"MediaBox")).and_then(Object::as_array).ok()?;
    let v: Vec<f64> = arr.iter().filter_map(number).collect();
    let [a, b, c, d] = v[..] else { return None };
    Some([a.min(c), b.min(d), a.max(c), b.max(d)])
}

/// Moves the numbers of a coordinate array (flat x, y pairs, or arrays of them).
fn transform_points(o: &mut Object, s: f64, ox: f64, oy: f64) {
    let Object::Array(items) = o else { return };
    if items.iter().all(|i| matches!(i, Object::Array(_))) {
        for i in items.iter_mut() {
            transform_points(i, s, ox, oy);
        }
        return;
    }
    for (k, item) in items.iter_mut().enumerate() {
        if let Some(v) = number(item) {
            *item = Object::Real((v * s + if k % 2 == 0 { ox } else { oy }) as f32);
        }
    }
}

/// Fits the page in `dict` onto `sheet`. `moved` remembers annotations already
/// moved, since a page used twice shares them.
pub fn fit_page(doc: &mut Document, dict: &mut Dictionary, sheet: &Sheet, moved: &mut HashSet<ObjectId>) -> AppResult<()> {
    let Some(page) = visible_box(dict) else { return Ok(()) };
    if page[2] - page[0] <= 0.0 || page[3] - page[1] <= 0.0 || sheet.w <= 0.0 || sheet.h <= 0.0 {
        return Ok(());
    }
    let (s, ox, oy) = fit(page, sheet);

    // The page's content, as one form with the page's resources and box…
    if let Ok(contents) = dict.get(b"Contents").cloned() {
        let refs: Vec<Object> = match contents {
            Object::Array(items) => items,
            other => vec![other],
        };
        let mut content = Vec::new();
        for r in refs {
            let Ok(id) = r.as_reference() else { continue };
            if let Ok(stream) = doc.get_object(id).and_then(Object::as_stream) {
                content.extend(stream.decompressed_content().unwrap_or_else(|_| stream.content.clone()));
                content.push(b'\n');
            }
        }
        let mut form = Dictionary::new();
        form.set("Type", "XObject");
        form.set("Subtype", "Form");
        form.set("BBox", page.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>());
        if let Ok(resources) = dict.get(b"Resources") {
            form.set("Resources", resources.clone());
        }
        if let Ok(group) = dict.get(b"Group") {
            form.set("Group", group.clone());
        }
        let mut stream = Stream::new(form, content);
        let _ = stream.compress();
        let form_id = doc.add_object(stream);
        // … drawn scaled and centered on the new paper.
        let draw = format!("q {s:.6} 0 0 {s:.6} {ox:.4} {oy:.4} cm /KlikPaperPage Do Q\n");
        let draw_id = doc.add_object(Stream::new(Dictionary::new(), draw.into_bytes()));
        dict.set("Contents", draw_id);
        let mut xobjects = Dictionary::new();
        xobjects.set("KlikPaperPage", form_id);
        let mut resources = Dictionary::new();
        resources.set("XObject", xobjects);
        dict.set("Resources", resources);
    }

    let paper: Vec<Object> = vec![0.into(), 0.into(), Object::Real(sheet.w as f32), Object::Real(sheet.h as f32)];
    dict.set("MediaBox", paper.clone());
    dict.set("CropBox", paper);
    for key in [&b"BleedBox"[..], b"TrimBox", b"ArtBox"] {
        dict.remove(key);
    }

    // Annotations keep their place on the content.
    let annots = match dict.get(b"Annots") {
        Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
        Ok(Object::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    for annot in annots {
        let Object::Reference(id) = annot else { continue };
        if !moved.insert(id) {
            continue;
        }
        if let Ok(a) = doc.get_dictionary_mut(id) {
            for key in [&b"Rect"[..], b"QuadPoints", b"Vertices", b"L", b"InkList"] {
                if let Ok(o) = a.get_mut(key) {
                    transform_points(o, s, ox, oy);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A4: Sheet = Sheet { w: 595.28, h: 841.89, margin: 0.0 };

    #[test]
    fn fits_and_centers_without_stretching() {
        // US Letter onto A4: limited by width, centered vertically.
        let (s, ox, oy) = fit([0.0, 0.0, 612.0, 792.0], &A4);
        assert!((s - 595.28 / 612.0).abs() < 1e-9);
        assert!(ox.abs() < 1e-9);
        assert!((oy - (841.89 - 792.0 * s) / 2.0).abs() < 1e-9);
        // A box that doesn't start at the origin is moved back onto the paper.
        let (s, ox, _) = fit([100.0, 50.0, 712.0, 842.0], &A4);
        assert!((ox + 100.0 * s).abs() < 1e-6);
        // Margins shrink the content inside them.
        let (s2, ox2, _) = fit([0.0, 0.0, 612.0, 792.0], &Sheet { margin: 36.0, ..A4 });
        assert!(s2 < s && (ox2 - 36.0).abs() < 1e-6);
    }

    #[test]
    fn moves_annotation_points() {
        let mut rect = Object::Array(vec![10.into(), 20.into(), 30.into(), 40.into()]);
        transform_points(&mut rect, 2.0, 5.0, 7.0);
        let v: Vec<f64> = rect.as_array().unwrap().iter().filter_map(number).collect();
        assert_eq!(v, [25.0, 47.0, 65.0, 87.0]);
        let mut ink = Object::Array(vec![Object::Array(vec![1.into(), 1.into()]), Object::Array(vec![2.into(), 3.into()])]);
        transform_points(&mut ink, 10.0, 0.0, 1.0);
        let second: Vec<f64> = ink.as_array().unwrap()[1].as_array().unwrap().iter().filter_map(number).collect();
        assert_eq!(second, [20.0, 31.0]);
    }
}
