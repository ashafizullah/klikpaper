//! Recognized text (OCR) on scanned pages. The frontend runs Tesseract on a
//! picture of the page and gets back a one-page PDF holding only the words,
//! in invisible text, sized to the picture. That page becomes a form XObject
//! drawn over the original page, scaled to it and turned back by the page's
//! rotation, so the words lie on the letters they were read from: they can
//! be searched, selected, copied and redacted, and change nothing visible.
use super::sheet::visible_box;
use crate::error::{AppError, AppResult};
use lopdf::content::Content;
use lopdf::{Dictionary, Document, Object, Stream};
use serde::Deserialize;
use std::path::Path;

/// The text layer for one page.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    /// The PDF Tesseract wrote (text only).
    pub path: String,
    /// Clockwise degrees the page was turned when its picture was taken (as shown on screen).
    #[serde(default)]
    pub rotation: i64,
}

/// Where a box of `w`×`h` (the picture, upright as shown) lands on the
/// unrotated page `view` turned clockwise by `rotation`: a matrix from the
/// layer's space to the page's.
fn placement(view: [f64; 4], w: f64, h: f64, rotation: i64) -> [f64; 6] {
    let [x0, y0, x1, y1] = view;
    let (pw, ph) = (x1 - x0, y1 - y0);
    let r = rotation.rem_euclid(360) / 90 * 90;
    let (dw, dh) = if r % 180 == 0 { (pw, ph) } else { (ph, pw) };
    let (sx, sy) = (dw / w, dh / h);
    match r {
        90 => [0.0, sx, -sy, 0.0, x0 + pw, y0],
        180 => [-sx, 0.0, 0.0, -sy, x0 + pw, y0 + ph],
        270 => [0.0, -sx, sy, 0.0, x0, y0 + ph],
        _ => [sx, 0.0, 0.0, sy, x0, y0],
    }
}

/// Draws the words of `layer` over the page in `dict` (not yet in the document).
pub fn add(doc: &mut Document, dict: &mut Dictionary, layer: &TextLayer) -> AppResult<()> {
    let mut ocr = super::load(Path::new(&layer.path), None)?;
    // The layer's objects (its fonts) move past this document's numbers.
    ocr.renumber_objects_with(doc.max_id + 1);
    let Some(&page_id) = ocr.get_pages().values().next() else { return Err(AppError::msg("The recognized text has no page")) };
    let page = super::flattened_page(&ocr, page_id)?;
    let content = stretch_words(&ocr.get_page_content(page_id));
    let Some(bx) = visible_box(&page) else { return Err(AppError::msg("The recognized text has no size")) };
    let (w, h) = (bx[2] - bx[0], bx[3] - bx[1]);
    let Some(view) = visible_box(dict) else { return Err(AppError::msg("The page has no size")) };
    if w <= 0.0 || h <= 0.0 || view[2] <= view[0] || view[3] <= view[1] {
        return Ok(());
    }
    let resources = match page.get(b"Resources") {
        Ok(Object::Reference(id)) => ocr.get_dictionary(*id)?.clone(),
        Ok(Object::Dictionary(d)) => d.clone(),
        _ => Dictionary::new(),
    };
    doc.max_id = doc.max_id.max(ocr.max_id);
    doc.objects.extend(ocr.objects);

    let mut form = Dictionary::new();
    form.set("Type", "XObject");
    form.set("Subtype", "Form");
    form.set("BBox", bx.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>());
    form.set("Resources", resources);
    let mut stream = Stream::new(form, content);
    let _ = stream.compress();
    let form_id = doc.add_object(stream);

    // The page's own resources get the form under a name of its own.
    let mut res = match dict.get(b"Resources") {
        Ok(Object::Reference(id)) => doc.get_dictionary(*id)?.clone(),
        Ok(Object::Dictionary(d)) => d.clone(),
        _ => Dictionary::new(),
    };
    let mut xobjects = match res.get(b"XObject") {
        Ok(Object::Reference(id)) => doc.get_dictionary(*id)?.clone(),
        Ok(Object::Dictionary(d)) => d.clone(),
        _ => Dictionary::new(),
    };
    let name = (0..)
        .map(|n| if n == 0 { "KlikPaperText".to_string() } else { format!("KlikPaperText{n}") })
        .find(|n| !xobjects.has(n.as_bytes()))
        .unwrap();
    xobjects.set(name.as_bytes().to_vec(), form_id);
    res.set("XObject", xobjects);
    dict.set("Resources", res);

    // Drawn after the page's own content, in default user space.
    let m = placement(view, w, h, layer.rotation);
    let draw = format!("Q q {:.6} {:.6} {:.6} {:.6} {:.4} {:.4} cm /{name} Do Q\n", m[0], m[1], m[2], m[3], m[4], m[5]);
    let open = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
    let close = doc.add_object(Stream::new(Dictionary::new(), format!("\n{draw}").into_bytes()));
    let mut contents = vec![Object::Reference(open)];
    match dict.get(b"Contents") {
        Ok(Object::Array(items)) => contents.extend(items.iter().cloned()),
        Ok(other) => contents.push(other.clone()),
        Err(_) => {}
    }
    contents.push(Object::Reference(close));
    dict.set("Contents", contents);
    Ok(())
}

/// Tesseract writes each word with the space after it and squeezes both into
/// the word's box, so the letters end short of the ink they were read from
/// (a black box made from them could leave the last letter showing). Each
/// word's horizontal scaling is widened so its letters fill the box; the
/// space hangs into the gap, where the next word's position doesn't depend on it.
fn stretch_words(content: &[u8]) -> Vec<u8> {
    let Ok(mut ops) = Content::decode(content).map(|c| c.operations) else { return content.to_vec() };
    // The Tz set for the word being written, if it was set for that word alone.
    let mut scaling: Option<usize> = None;
    for i in 0..ops.len() {
        match ops[i].operator.as_str() {
            "Tz" => scaling = Some(i),
            "TJ" | "Tj" => {
                let bytes: Vec<u8> = match ops[i].operands.first() {
                    Some(Object::Array(items)) => items.iter().filter_map(|o| o.as_str().ok()).flatten().copied().collect(),
                    Some(Object::String(b, _)) => b.clone(),
                    _ => Vec::new(),
                };
                let glyphs = bytes.len() / 2;
                if let Some(t) = scaling.take()
                    && glyphs >= 2
                    && bytes.ends_with(&[0, 32])
                    && let Some(tz) = ops[t].operands.first().and_then(|o| o.as_float().ok())
                {
                    let wider = f64::from(tz) * glyphs as f64 / (glyphs - 1) as f64;
                    ops[t].operands = vec![Object::Real(wider as f32)];
                }
            }
            _ => {}
        }
    }
    Content { operations: ops }.encode().unwrap_or_else(|_| content.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puts_the_words_over_the_page() {
        use crate::pdf::tests::{labels, temp_dir, write_sample};
        use crate::pdf::{AssembleJob, Options, PageRef, Source, assemble};
        use lopdf::dictionary;
        let dir = temp_dir();
        let a = write_sample(&dir, "scan.pdf", &["A1"]);
        // A text-only page as Tesseract writes it: invisible words, sized to the picture.
        let mut layer = Document::with_version("1.5");
        let font = layer.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let content = layer.add_object(Stream::new(dictionary! {}, b"BT 3 Tr /F1 12 Tf 10 20 Td (Halo dunia) Tj ET".to_vec()));
        let pages = layer.new_object_id();
        let page = layer.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(), 0.into(), 306.into(), 396.into()], "Contents" => content, "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } } });
        layer.objects.insert(pages, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }));
        let catalog = layer.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        layer.trailer.set("Root", catalog);
        let layer_path = dir.join("layer.pdf");
        layer.save(&layer_path).unwrap();

        let out = dir.join("out.pdf").display().to_string();
        let job = AssembleJob {
            sources: vec![Source { id: "a".into(), path: a, password: None }],
            pages: vec![PageRef {
                source: "a".into(),
                index: 0,
                rotate: 0,
                sheet: None,
                comments: None,
                redact: Vec::new(),
                raster: None,
                ocr: Some(TextLayer { path: layer_path.display().to_string(), rotation: 0 }),
                scan: None,
            }],
            output: out.clone(),
            options: Options::default(),
            outline: None,
        };
        assemble(&job).unwrap();
        let doc = Document::load(&out).unwrap();
        // The page still shows what it showed…
        assert_eq!(labels(&doc), ["A1"]);
        // …and draws the words, scaled by two onto the 612×792 page.
        let id = *doc.get_pages().get(&1).unwrap();
        let text = String::from_utf8_lossy(&doc.get_page_content(id)).into_owned();
        assert!(text.contains("2.000000 0.000000 0.000000 2.000000 0.0000 0.0000 cm /KlikPaperText Do"), "{text}");
        let res = doc.get_dictionary(id).unwrap().get(b"Resources").unwrap().as_dict().unwrap();
        let form = res.get(b"XObject").unwrap().as_dict().unwrap().get(b"KlikPaperText").unwrap().as_reference().unwrap();
        let form = doc.get_object(form).unwrap().as_stream().unwrap();
        let ops = Content::decode(&form.decompressed_content().unwrap_or(form.content.clone())).unwrap().operations;
        assert!(ops.iter().any(|o| o.operator == "Tj"));
        assert!(form.dict.get(b"Resources").unwrap().as_dict().unwrap().has(b"Font"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn stretches_letters_over_the_word_box() {
        let out = stretch_words(b"BT 3 Tr /f 11 Tf 100 Tz [<0041004200430020>] TJ 30 0 Td 50 Tz [<0020>] TJ ET");
        let text = String::from_utf8_lossy(&out).into_owned();
        // Three letters and a space were squeezed into the box; the letters now fill it.
        assert!(text.contains("133.33333 Tz"), "{text}");
        assert!(text.contains("50 Tz"), "{text}");
    }

    #[test]
    fn places_the_layer_on_the_page_for_each_rotation() {
        let view = [0.0, 0.0, 600.0, 800.0];
        let apply = |m: [f64; 6], x: f64, y: f64| (x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]);
        // Upright: the picture's corners are the page's.
        let m = placement(view, 300.0, 400.0, 0);
        assert_eq!(apply(m, 300.0, 400.0), (600.0, 800.0));
        // Shown turned 90° clockwise, the picture is 800 wide and 600 high; its top-left
        // (0, 600 in the layer) is the page's bottom-left.
        let m = placement(view, 400.0, 300.0, 90);
        assert_eq!(apply(m, 0.0, 300.0), (0.0, 0.0));
        assert_eq!(apply(m, 400.0, 300.0), (0.0, 800.0));
        let m = placement(view, 300.0, 400.0, 180);
        assert_eq!(apply(m, 0.0, 0.0), (600.0, 800.0));
        let m = placement(view, 400.0, 300.0, 270);
        assert_eq!(apply(m, 0.0, 300.0), (600.0, 800.0));
    }
}
