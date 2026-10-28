//! Redaction: what lies under marked areas of a page is removed from the file,
//! not just covered, and the areas are painted black. Text loses the glyphs
//! inside an area (the rest of the line keeps its place), images lose the
//! pixels, small vector shapes go, and so do annotations and form fields that
//! touch an area. Content that can't be taken apart safely (a font whose glyph
//! widths are unknown, an image encoding that can't be rewritten, content that
//! doesn't parse) is reported instead, and the caller replaces that page with
//! a picture of it (`rasterize`).
use super::sheet::visible_box;
use crate::error::{AppError, AppResult};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder};
use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::Path;
use std::rc::Rc;

/// An area to redact, in points from the page's top-left corner (unrotated, y down).
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// How much of a glyph, along each axis, must lie in an area for it to be removed.
const GLYPH_SHARE: f64 = 0.3;
/// The same for a vector shape: shapes crossing an area (table rules, borders) stay.
const SHAPE_SHARE: f64 = 0.5;
/// Nesting of forms inside forms followed before giving up.
const MAX_DEPTH: usize = 12;
/// Decoded image data beyond this is not rewritten (the page becomes a picture instead).
const MAX_IMAGE_BYTES: usize = 256 * 1024 * 1024;
/// Name of the picture that replaces a page's content.
const PICTURE: &str = "KlikPaperRedacted";

/// A PDF transformation matrix [a b c d e f]; points are row vectors (p × M).
#[derive(Clone, Copy, Debug, PartialEq)]
struct Matrix([f64; 6]);

impl Matrix {
    const IDENTITY: Matrix = Matrix([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    fn translate(x: f64, y: f64) -> Matrix {
        Matrix([1.0, 0.0, 0.0, 1.0, x, y])
    }

    /// `self` applied first, then `o`.
    fn then(self, o: Matrix) -> Matrix {
        let [a, b, c, d, e, f] = self.0;
        let [a2, b2, c2, d2, e2, f2] = o.0;
        Matrix([a * a2 + b * c2, a * b2 + b * d2, c * a2 + d * c2, c * b2 + d * d2, e * a2 + f * c2 + e2, e * b2 + f * d2 + f2])
    }

    fn apply(self, x: f64, y: f64) -> (f64, f64) {
        let [a, b, c, d, e, f] = self.0;
        (x * a + y * c + e, x * b + y * d + f)
    }

    fn invert(self) -> Option<Matrix> {
        let [a, b, c, d, e, f] = self.0;
        let det = a * d - b * c;
        if det.abs() < 1e-12 {
            return None;
        }
        let (ia, ib, ic, id) = (d / det, -b / det, -c / det, a / det);
        Some(Matrix([ia, ib, ic, id, -(e * ia + f * ic), -(e * ib + f * id)]))
    }

    fn from_operands(ops: &[Object]) -> Option<Matrix> {
        let v: Vec<f64> = ops.iter().filter_map(number).collect();
        let [a, b, c, d, e, f] = v[..] else { return None };
        Some(Matrix([a, b, c, d, e, f]))
    }
}

/// An axis-aligned box in user space.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

impl Bounds {
    fn of(points: impl IntoIterator<Item = (f64, f64)>) -> Option<Bounds> {
        let mut b: Option<Bounds> = None;
        for (x, y) in points {
            if !x.is_finite() || !y.is_finite() {
                continue;
            }
            b = Some(match b {
                None => Bounds { x0: x, y0: y, x1: x, y1: y },
                Some(b) => Bounds { x0: b.x0.min(x), y0: b.y0.min(y), x1: b.x1.max(x), y1: b.y1.max(y) },
            });
        }
        b
    }

    /// The box around a rectangle after a transformation.
    fn around(m: Matrix, x0: f64, y0: f64, x1: f64, y1: f64) -> Bounds {
        Bounds::of([m.apply(x0, y0), m.apply(x1, y0), m.apply(x0, y1), m.apply(x1, y1)]).unwrap_or(Bounds {
            x0: f64::NAN,
            y0: f64::NAN,
            x1: f64::NAN,
            y1: f64::NAN,
        })
    }

    /// Whether the boxes meet (edges included).
    fn touches(&self, o: &Bounds) -> bool {
        self.x0 <= o.x1 && o.x0 <= self.x1 && self.y0 <= o.y1 && o.y0 <= self.y1
    }

    /// The share of this box, along each axis, that lies inside `area`.
    fn share_in(&self, area: &Bounds) -> (f64, f64) {
        fn axis(lo: f64, hi: f64, alo: f64, ahi: f64) -> f64 {
            if hi - lo < 1e-6 {
                return if lo >= alo && lo <= ahi { 1.0 } else { 0.0 };
            }
            ((hi.min(ahi) - lo.max(alo)) / (hi - lo)).max(0.0)
        }
        (axis(self.x0, self.x1, area.x0, area.x1), axis(self.y0, self.y1, area.y0, area.y1))
    }
}

fn covered(b: &Bounds, areas: &[Bounds], share: f64) -> bool {
    areas.iter().any(|a| {
        let (sx, sy) = b.share_in(a);
        sx >= share && sy >= share
    })
}

fn touches_any(b: &Bounds, areas: &[Bounds]) -> bool {
    areas.iter().any(|a| b.touches(a))
}

fn number(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

fn num_at(ops: &[Object], i: usize) -> f64 {
    ops.get(i).and_then(number).unwrap_or(0.0)
}

fn deref<'a>(doc: &'a Document, o: &'a Object) -> &'a Object {
    doc.dereference(o).map(|(_, o)| o).unwrap_or(o)
}

fn dict_at(doc: &Document, d: &Dictionary, key: &[u8]) -> Option<Dictionary> {
    deref(doc, d.get(key).ok()?).as_dict().ok().cloned()
}

// ---- fonts ------------------------------------------------------------------

/// What redaction needs to know about a font: where each glyph ends.
struct Font {
    two_byte: bool,
    /// Advance per character code, in text space units at size 1.
    widths: HashMap<u32, f64>,
    default_width: f64,
    /// Bottom and top of a glyph box, in the same units.
    descent: f64,
    ascent: f64,
    /// False when the glyph widths (or the code length) can't be known; text in
    /// such a font is never taken apart.
    known: bool,
}

impl Font {
    fn width(&self, code: u32) -> f64 {
        self.widths.get(&code).copied().unwrap_or(self.default_width)
    }

    /// Character codes with their bytes.
    fn codes<'a>(&self, bytes: &'a [u8]) -> Vec<(u32, &'a [u8])> {
        if self.two_byte {
            bytes.chunks(2).map(|c| (c.iter().fold(0u32, |v, b| (v << 8) | u32::from(*b)), c)).collect()
        } else {
            bytes.chunks(1).map(|c| (u32::from(c[0]), c)).collect()
        }
    }

    fn unknown() -> Font {
        Font { two_byte: false, widths: HashMap::new(), default_width: 0.0, descent: -0.25, ascent: 1.0, known: false }
    }

    fn load(doc: &Document, dict: &Dictionary) -> Font {
        let name = |d: &Dictionary, key: &[u8]| d.get(key).ok().map(|o| deref(doc, o)).and_then(|o| o.as_name().ok()).map(<[u8]>::to_vec);
        let (mut descent, mut ascent) = (-0.25, 1.0);
        let mut vertical_metrics = |desc: &Dictionary| {
            let a = desc.get(b"Ascent").ok().and_then(number).map(|v| v / 1000.0);
            let d = desc.get(b"Descent").ok().and_then(number).map(|v| v / 1000.0);
            // Some fonts carry zeros or nonsense here; keep a generous box then.
            if let Some(a) = a.filter(|a| (0.5..=2.0).contains(a)) {
                ascent = a.max(0.8);
            }
            if let Some(d) = d.filter(|d| (-1.0..=0.0).contains(d)) {
                descent = d.min(-0.2);
            }
        };
        match name(dict, b"Subtype").as_deref() {
            Some(b"Type0") => {
                // Only Identity-H says how long each code is and which CID it is.
                let encoding = name(dict, b"Encoding");
                let Some(descendant) = dict
                    .get(b"DescendantFonts")
                    .ok()
                    .map(|o| deref(doc, o))
                    .and_then(|o| o.as_array().ok())
                    .and_then(|a| a.first())
                    .map(|o| deref(doc, o))
                    .and_then(|o| o.as_dict().ok())
                else {
                    return Font::unknown();
                };
                if let Some(desc) = dict_at(doc, descendant, b"FontDescriptor") {
                    vertical_metrics(&desc);
                }
                let default_width = descendant.get(b"DW").ok().and_then(number).unwrap_or(1000.0) / 1000.0;
                let mut widths = HashMap::new();
                if let Some(w) = descendant.get(b"W").ok().map(|o| deref(doc, o)).and_then(|o| o.as_array().ok()) {
                    let mut i = 0;
                    while i < w.len() {
                        let Some(first) = number(deref(doc, &w[i])) else { break };
                        match w.get(i + 1).map(|o| deref(doc, o)) {
                            Some(Object::Array(list)) => {
                                for (k, v) in list.iter().enumerate() {
                                    if let Some(v) = number(deref(doc, v)) {
                                        widths.insert(first as u32 + k as u32, v / 1000.0);
                                    }
                                }
                                i += 2;
                            }
                            Some(last) => {
                                let (Some(last), Some(v)) = (number(last), w.get(i + 2).map(|o| deref(doc, o)).and_then(number)) else {
                                    break;
                                };
                                // A crafted range can't make this loop run long.
                                for c in (first as u32)..=(last as u32).min(first as u32 + 0xFFFF) {
                                    widths.insert(c, v / 1000.0);
                                }
                                i += 3;
                            }
                            None => break,
                        }
                    }
                }
                let known = encoding.as_deref() == Some(b"Identity-H");
                Font { two_byte: true, widths, default_width, descent, ascent, known }
            }
            Some(b"Type3") => {
                let fm: Vec<f64> = dict
                    .get(b"FontMatrix")
                    .ok()
                    .map(|o| deref(doc, o))
                    .and_then(|o| o.as_array().ok())
                    .map(|a| a.iter().filter_map(number).collect())
                    .unwrap_or_default();
                let (sx, sy) = match fm[..] {
                    [a, _, _, d, _, _] => (a, d),
                    _ => (0.001, 0.001),
                };
                let bbox: Vec<f64> = dict
                    .get(b"FontBBox")
                    .ok()
                    .map(|o| deref(doc, o))
                    .and_then(|o| o.as_array().ok())
                    .map(|a| a.iter().filter_map(number).collect())
                    .unwrap_or_default();
                if let [_, y0, _, y1] = bbox[..]
                    && y1 > y0
                {
                    descent = (y0 * sy).min(y1 * sy).min(-0.2);
                    ascent = (y0 * sy).max(y1 * sy).max(0.8);
                }
                let (widths, known) = simple_widths(doc, dict, sx);
                Font { two_byte: false, widths, default_width: 0.0, descent, ascent, known }
            }
            _ => {
                let desc = dict_at(doc, dict, b"FontDescriptor");
                if let Some(desc) = &desc {
                    vertical_metrics(desc);
                }
                let (mut widths, mut known) = simple_widths(doc, dict, 0.001);
                let mut default_width = desc.as_ref().and_then(|d| d.get(b"MissingWidth").ok()).and_then(number).unwrap_or(0.0) / 1000.0;
                // Without a width table, the standard 14 fonts have known metrics.
                if !known && let Some(base) = name(dict, b"BaseFont") {
                    match standard_font(&base) {
                        Some(Standard::Courier) => {
                            default_width = 0.6;
                            known = true;
                        }
                        Some(Standard::Table(metrics, builtin)) => {
                            if let Some(found) = standard_widths(doc, dict, metrics, builtin) {
                                widths = found;
                                known = true;
                            }
                        }
                        None => {}
                    }
                }
                Font { two_byte: false, widths, default_width, descent, ascent, known }
            }
        }
    }
}

enum Standard {
    Courier,
    /// Widths by glyph name, and the font's built-in encoding.
    Table(&'static [(&'static str, u16)], &'static [&'static str; 256]),
}

/// Which standard font a base font name is (also under the names Windows gives them, like ArialMT).
fn standard_font(base: &[u8]) -> Option<Standard> {
    // A subset prefix ("ABCDEF+") and punctuation don't matter.
    let base = match base.iter().position(|&b| b == b'+') {
        Some(6) => &base[7..],
        _ => base,
    };
    let n: String = String::from_utf8_lossy(base).to_ascii_lowercase().chars().filter(char::is_ascii_alphanumeric).collect();
    let bold = n.contains("bold");
    let italic = n.contains("italic") || n.contains("oblique");
    use super::std14::*;
    Some(if n.starts_with("courier") {
        Standard::Courier
    } else if n.starts_with("helvetica") || n.starts_with("arial") {
        Standard::Table(if bold { HELVETICA_BOLD } else { HELVETICA }, &STANDARD)
    } else if n.starts_with("times") {
        let table = match (bold, italic) {
            (false, false) => TIMES_ROMAN,
            (true, false) => TIMES_BOLD,
            (false, true) => TIMES_ITALIC,
            (true, true) => TIMES_BOLDITALIC,
        };
        Standard::Table(table, &STANDARD)
    } else if n == "symbol" {
        Standard::Table(SYMBOL, &SYMBOL_ENCODING)
    } else if n == "zapfdingbats" {
        Standard::Table(ZAPFDINGBATS, &ZAPF_DINGBATS_ENCODING)
    } else {
        return None;
    })
}

/// Widths per code of a standard font through its encoding (with /Differences); None when the encoding is unknown.
fn standard_widths(doc: &Document, dict: &Dictionary, metrics: &[(&str, u16)], builtin: &[&str; 256]) -> Option<HashMap<u32, f64>> {
    let named = |n: &[u8]| -> Option<&'static [&'static str; 256]> {
        use super::std14::{STANDARD, WIN_ANSI};
        match n {
            b"WinAnsiEncoding" => Some(&WIN_ANSI),
            b"StandardEncoding" => Some(&STANDARD),
            _ => None,
        }
    };
    let mut names: Vec<String> = builtin.iter().map(|s| s.to_string()).collect();
    match dict.get(b"Encoding").ok().map(|o| deref(doc, o)) {
        None => {}
        Some(Object::Name(n)) => names = named(n)?.iter().map(|s| s.to_string()).collect(),
        Some(Object::Dictionary(enc)) => {
            if let Ok(base) = enc.get(b"BaseEncoding").and_then(Object::as_name) {
                names = named(base)?.iter().map(|s| s.to_string()).collect();
            }
            if let Some(diffs) = enc.get(b"Differences").ok().map(|o| deref(doc, o)).and_then(|o| o.as_array().ok()) {
                let mut code = 0usize;
                for d in diffs {
                    match deref(doc, d) {
                        Object::Integer(c) => code = (*c).clamp(0, 255) as usize,
                        Object::Name(n) => {
                            if code < 256 {
                                names[code] = String::from_utf8_lossy(n).into_owned();
                            }
                            code += 1;
                        }
                        _ => {}
                    }
                }
            }
        }
        Some(_) => return None,
    }
    let width = |name: &str| metrics.binary_search_by(|(n, _)| (*n).cmp(name)).ok().map(|i| f64::from(metrics[i].1) / 1000.0);
    Some(names.iter().enumerate().filter_map(|(code, n)| width(n).map(|w| (code as u32, w))).collect())
}

/// The /Widths table of a simple font, scaled to text space; false when it has none.
fn simple_widths(doc: &Document, dict: &Dictionary, scale: f64) -> (HashMap<u32, f64>, bool) {
    let first = dict.get(b"FirstChar").ok().and_then(number).unwrap_or(0.0).max(0.0) as u32;
    let Some(list) = dict.get(b"Widths").ok().map(|o| deref(doc, o)).and_then(|o| o.as_array().ok()) else {
        return (HashMap::new(), false);
    };
    let widths = list.iter().enumerate().filter_map(|(i, w)| number(deref(doc, w)).map(|w| (first + i as u32, w * scale))).collect();
    (widths, true)
}

// ---- content ------------------------------------------------------------------

#[derive(Clone)]
struct State {
    ctm: Matrix,
    font: Option<Rc<Font>>,
    size: f64,
    char_space: f64,
    word_space: f64,
    /// Horizontal scaling (Tz / 100).
    scale: f64,
    leading: f64,
    rise: f64,
}

impl State {
    fn new(ctm: Matrix) -> State {
        State { ctm, font: None, size: 0.0, char_space: 0.0, word_space: 0.0, scale: 1.0, leading: 0.0, rise: 0.0 }
    }

    /// Glyph space (em units along the baseline) to user space, at text matrix `tm`.
    fn glyph_space(&self, tm: Matrix) -> Matrix {
        Matrix([self.size * self.scale, 0.0, 0.0, self.size, 0.0, self.rise]).then(tm).then(self.ctm)
    }
}

struct Redactor<'a> {
    doc: &'a mut Document,
    areas: Vec<Bounds>,
    fonts: HashMap<ObjectId, Rc<Font>>,
    /// Why the page has to become a picture, if it does.
    issue: Option<String>,
}

impl Redactor<'_> {
    fn flag(&mut self, why: &str) {
        self.issue.get_or_insert_with(|| why.to_string());
    }

    fn font(&mut self, res: &Dictionary, name: &[u8]) -> Option<Rc<Font>> {
        let fonts = dict_at(self.doc, res, b"Font")?;
        let entry = fonts.get(name).ok()?;
        if let Ok(id) = entry.as_reference() {
            if let Some(f) = self.fonts.get(&id) {
                return Some(f.clone());
            }
            let font = Rc::new(Font::load(self.doc, self.doc.get_dictionary(id).ok()?));
            self.fonts.insert(id, font.clone());
            return Some(font);
        }
        Some(Rc::new(Font::load(self.doc, entry.as_dict().ok()?)))
    }

    /// Whether text starting at `tm` (of unknown length, running along the
    /// baseline) could reach an area.
    fn line_reaches(&self, gs: &State, tm: Matrix) -> bool {
        let (descent, ascent) = gs.font.as_ref().map_or((-0.25, 1.0), |f| (f.descent, f.ascent));
        let m = gs.glyph_space(tm);
        let Some(inv) = m.invert() else {
            let (x, y) = m.apply(0.0, 0.0);
            return touches_any(&Bounds { x0: x, y0: y, x1: x, y1: y }, &self.areas);
        };
        self.areas.iter().any(|a| {
            let b = Bounds::around(inv, a.x0, a.y0, a.x1, a.y1);
            b.x1 >= 0.0 && b.y0 <= ascent && b.y1 >= descent
        })
    }

    /// The glyphs of one text-showing operator: a TJ array without the glyphs
    /// inside an area (their advance kept as spacing), or None when nothing
    /// is removed. Moves `tm` past the text when the widths are known.
    fn show(&mut self, items: &[Object], gs: &State, tm: &mut Matrix, adrift: &mut bool) -> Option<Vec<Object>> {
        let font = match &gs.font {
            Some(f) if f.known && !*adrift => f.clone(),
            _ => {
                if self.line_reaches(gs, *tm) {
                    self.flag("text in a font whose glyph widths are unknown");
                }
                // The rest of the line can't be placed either.
                *adrift = true;
                return None;
            }
        };
        let unit = gs.size * gs.scale;
        let mut out: Vec<Object> = Vec::new();
        let mut removed = false;
        // Advance not yet written out, in text space units.
        let mut pending = 0.0;
        let flush = |out: &mut Vec<Object>, pending: &mut f64| {
            if pending.abs() > 1e-9 {
                out.push(Object::Real((-*pending * 1000.0 / unit) as f32));
            }
            *pending = 0.0;
        };
        for item in items {
            match item {
                Object::String(bytes, format) => {
                    let mut kept: Vec<u8> = Vec::new();
                    for (code, raw) in font.codes(bytes) {
                        let w = font.width(code);
                        let spacing = gs.char_space + if !font.two_byte && code == 32 { gs.word_space } else { 0.0 };
                        let tx = (w * gs.size + spacing) * gs.scale;
                        // A glyph without width still marks the spot it is drawn at.
                        let gw = if w.abs() < 0.05 { 0.25 } else { w };
                        let b = Bounds::around(gs.glyph_space(*tm), gw.min(0.0), font.descent, gw.max(0.0), font.ascent);
                        if covered(&b, &self.areas, GLYPH_SHARE) {
                            removed = true;
                            if !kept.is_empty() {
                                out.push(Object::String(std::mem::take(&mut kept), *format));
                            }
                            pending += tx;
                        } else {
                            if kept.is_empty() {
                                flush(&mut out, &mut pending);
                            }
                            kept.extend_from_slice(raw);
                        }
                        *tm = Matrix::translate(tx, 0.0).then(*tm);
                    }
                    if !kept.is_empty() {
                        out.push(Object::String(kept, *format));
                    }
                }
                other => {
                    let v = number(other).unwrap_or(0.0);
                    let tx = -v / 1000.0 * gs.size * gs.scale;
                    *tm = Matrix::translate(tx, 0.0).then(*tm);
                    pending += tx;
                }
            }
        }
        if !removed {
            return None;
        }
        if unit.abs() < 1e-9 && pending.abs() > 1e-9 {
            self.flag("text drawn at size zero");
            return None;
        }
        flush(&mut out, &mut pending);
        Some(out)
    }

    /// Rewrites an XObject drawn under an area; true when its entry in `res` now names a changed copy.
    fn xobject(&mut self, res: &mut Dictionary, name: &[u8], ctm: Matrix, depth: usize) -> bool {
        let Some(xobjects) = dict_at(self.doc, res, b"XObject") else { return false };
        let Some(id) = xobjects.get(name).ok().and_then(|o| o.as_reference().ok()) else { return false };
        let Ok(stream) = self.doc.get_object(id).and_then(Object::as_stream) else { return false };
        let subtype = stream.dict.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"");
        let new = match subtype {
            b"Image" => {
                if !touches_any(&Bounds::around(ctm, 0.0, 0.0, 1.0, 1.0), &self.areas) {
                    return false;
                }
                let mut image = stream.clone();
                match mask_image(self.doc, &mut image, ctm, &self.areas) {
                    Ok(false) => return false,
                    Ok(true) => {}
                    Err(why) => {
                        self.flag(why);
                        return false;
                    }
                }
                // The transparency mask is drawn in the same place; it can hold shapes too.
                if let Ok(mask_id) = image.dict.get(b"SMask").and_then(Object::as_reference)
                    && let Ok(mask) = self.doc.get_object(mask_id).and_then(Object::as_stream)
                {
                    let mut mask = mask.clone();
                    match mask_image(self.doc, &mut mask, ctm, &self.areas) {
                        Ok(true) => {
                            let new_mask = self.doc.add_object(mask);
                            image.dict.set("SMask", new_mask);
                        }
                        Ok(false) => {}
                        Err(why) => self.flag(why),
                    }
                }
                image
            }
            b"Form" => {
                if depth >= MAX_DEPTH {
                    self.flag("forms nested too deeply");
                    return false;
                }
                let form = stream.clone();
                let m = Matrix::from_operands(form.dict.get(b"Matrix").and_then(Object::as_array).map(Vec::as_slice).unwrap_or(&[]))
                    .unwrap_or(Matrix::IDENTITY)
                    .then(ctm);
                // A form draws only inside its box.
                if let Ok(bbox) = form.dict.get(b"BBox").and_then(Object::as_array) {
                    let v: Vec<f64> = bbox.iter().filter_map(number).collect();
                    if let [x0, y0, x1, y1] = v[..]
                        && !touches_any(&Bounds::around(m, x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)), &self.areas)
                    {
                        return false;
                    }
                }
                let Some(ops) = decode(&form) else {
                    self.flag("content that couldn't be read");
                    return false;
                };
                let mut form_res = dict_at(self.doc, &form.dict, b"Resources").unwrap_or_else(|| res.clone());
                let (ops, changed) = self.process(ops, &mut form_res, m, depth + 1);
                if !changed {
                    return false;
                }
                let mut dict = form.dict.clone();
                for key in [&b"Filter"[..], b"DecodeParms", b"Length"] {
                    dict.remove(key);
                }
                dict.set("Resources", form_res);
                let mut new = Stream::new(dict, encode(&ops));
                let _ = new.compress();
                new
            }
            _ => return false,
        };
        let new_id = self.doc.add_object(new);
        let mut xobjects = xobjects;
        xobjects.set(name.to_vec(), new_id);
        res.set("XObject", xobjects);
        true
    }

    /// Takes out what lies in the areas; returns the new operators and whether anything changed.
    fn process(&mut self, ops: Vec<Operation>, res: &mut Dictionary, ctm: Matrix, depth: usize) -> (Vec<Operation>, bool) {
        let mut out: Vec<Operation> = Vec::with_capacity(ops.len());
        let mut changed = false;
        let mut gs = State::new(ctm);
        let mut saved: Vec<State> = Vec::new();
        let (mut tm, mut tlm) = (Matrix::IDENTITY, Matrix::IDENTITY);
        // Set once text in a font with unknown widths was shown: the position along the line is lost.
        let mut adrift = false;
        let mut path: Vec<Operation> = Vec::new();
        let mut points: Vec<(f64, f64)> = Vec::new();
        let mut clip = false;
        // Open marked-content sequences (index in `out`, glyphs removed inside), and the closed ones that lost glyphs.
        let mut marks: Vec<(usize, bool)> = Vec::new();
        let mut touched: Vec<usize> = Vec::new();

        for op in ops {
            let o = op.operands.as_slice();
            match op.operator.as_str() {
                "m" | "l" | "c" | "v" | "y" | "re" | "h" | "W" | "W*" => {
                    let v: Vec<f64> = o.iter().filter_map(number).collect();
                    match op.operator.as_str() {
                        "re" if v.len() == 4 => {
                            let (x, y, w, h) = (v[0], v[1], v[2], v[3]);
                            points.extend([(x, y), (x + w, y), (x, y + h), (x + w, y + h)].map(|(x, y)| gs.ctm.apply(x, y)));
                        }
                        "W" | "W*" => clip = true,
                        _ => points.extend(v.as_chunks::<2>().0.iter().map(|[x, y]| gs.ctm.apply(*x, *y))),
                    }
                    path.push(op);
                    continue;
                }
                "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n" => {
                    let paints = op.operator != "n";
                    let gone = paints && Bounds::of(points.drain(..)).is_some_and(|b| covered(&b, &self.areas, SHAPE_SHARE));
                    if gone {
                        changed = true;
                        if clip {
                            out.append(&mut path);
                            out.push(Operation::new("n", vec![]));
                        } else {
                            path.clear();
                        }
                    } else {
                        out.append(&mut path);
                        out.push(op);
                    }
                    points.clear();
                    clip = false;
                    continue;
                }
                _ => {}
            }
            // Anything else ends a path that was never painted.
            if !path.is_empty() {
                out.append(&mut path);
                points.clear();
                clip = false;
            }
            match op.operator.as_str() {
                "q" => saved.push(gs.clone()),
                "Q" => {
                    if let Some(s) = saved.pop() {
                        gs = s;
                    }
                }
                "cm" => {
                    if let Some(m) = Matrix::from_operands(o) {
                        gs.ctm = m.then(gs.ctm);
                    }
                }
                "BT" => {
                    tm = Matrix::IDENTITY;
                    tlm = Matrix::IDENTITY;
                    adrift = false;
                }
                "Tc" => gs.char_space = num_at(o, 0),
                "Tw" => gs.word_space = num_at(o, 0),
                "Tz" => gs.scale = num_at(o, 0) / 100.0,
                "TL" => gs.leading = num_at(o, 0),
                "Ts" => gs.rise = num_at(o, 0),
                "Tf" => {
                    gs.font = o.first().and_then(|n| n.as_name().ok()).map(<[u8]>::to_vec).and_then(|n| self.font(res, &n));
                    gs.size = num_at(o, 1);
                }
                "Td" | "TD" => {
                    let (x, y) = (num_at(o, 0), num_at(o, 1));
                    if op.operator == "TD" {
                        gs.leading = -y;
                    }
                    tlm = Matrix::translate(x, y).then(tlm);
                    tm = tlm;
                    adrift = false;
                }
                "Tm" => {
                    if let Some(m) = Matrix::from_operands(o) {
                        tlm = m;
                        tm = m;
                        adrift = false;
                    }
                }
                "T*" => {
                    tlm = Matrix::translate(0.0, -gs.leading).then(tlm);
                    tm = tlm;
                    adrift = false;
                }
                "Tj" | "TJ" | "'" | "\"" => {
                    // ' and " move to the next line first; " also sets the spacing.
                    if op.operator == "\"" {
                        gs.word_space = num_at(o, 0);
                        gs.char_space = num_at(o, 1);
                    }
                    if op.operator == "'" || op.operator == "\"" {
                        tlm = Matrix::translate(0.0, -gs.leading).then(tlm);
                        tm = tlm;
                        adrift = false;
                    }
                    let shown: Vec<Object> = match (op.operator.as_str(), o) {
                        ("TJ", [Object::Array(items), ..]) => items.clone(),
                        ("Tj" | "'", [s, ..]) => vec![s.clone()],
                        ("\"", [_, _, s, ..]) => vec![s.clone()],
                        _ => Vec::new(),
                    };
                    if let Some(kept) = self.show(&shown, &gs, &mut tm, &mut adrift) {
                        changed = true;
                        for m in marks.iter_mut() {
                            m.1 = true;
                        }
                        match op.operator.as_str() {
                            "'" => out.push(Operation::new("T*", vec![])),
                            "\"" => {
                                out.push(Operation::new("Tw", vec![o[0].clone()]));
                                out.push(Operation::new("Tc", vec![o[1].clone()]));
                                out.push(Operation::new("T*", vec![]));
                            }
                            _ => {}
                        }
                        out.push(Operation::new("TJ", vec![Object::Array(kept)]));
                        continue;
                    }
                }
                "Do" => {
                    if let Some(name) = o.first().and_then(|n| n.as_name().ok()).map(<[u8]>::to_vec) {
                        changed |= self.xobject(res, &name, gs.ctm, depth);
                    }
                }
                "BI" => {
                    if let Some(Object::Stream(image)) = o.first()
                        && touches_any(&Bounds::around(gs.ctm, 0.0, 0.0, 1.0, 1.0), &self.areas)
                    {
                        let mut image = image.clone();
                        match mask_inline(&mut image, gs.ctm, &self.areas) {
                            Ok(true) => {
                                changed = true;
                                out.push(Operation::new("BI", vec![Object::Stream(image)]));
                                continue;
                            }
                            Ok(false) => {}
                            Err(why) => self.flag(why),
                        }
                    }
                }
                "BDC" | "BMC" => marks.push((out.len(), false)),
                "EMC" => {
                    if let Some((i, true)) = marks.pop() {
                        touched.push(i);
                    }
                }
                _ => {}
            }
            out.push(op);
        }
        out.append(&mut path);
        touched.extend(marks.iter().filter(|m| m.1).map(|m| m.0));
        // Replacement text and alternate descriptions of removed glyphs would still tell what they said.
        for i in touched {
            self.strip_replacement_text(&mut out[i], res);
        }
        (out, changed)
    }

    fn strip_replacement_text(&self, op: &mut Operation, res: &Dictionary) {
        const KEYS: [&[u8]; 3] = [b"ActualText", b"Alt", b"E"];
        if op.operator != "BDC" {
            return;
        }
        let props = match op.operands.get(1) {
            Some(Object::Dictionary(d)) => Some(d.clone()),
            Some(Object::Name(n)) => dict_at(self.doc, res, b"Properties")
                .and_then(|p| p.get(n).ok().map(|o| deref(self.doc, o).clone()))
                .and_then(|o| o.as_dict().ok().cloned()),
            _ => None,
        };
        let Some(mut props) = props else { return };
        if !KEYS.iter().any(|k| props.has(k)) {
            return;
        }
        for k in KEYS {
            props.remove(k);
        }
        op.operands[1] = Object::Dictionary(props);
    }
}

fn decode(stream: &Stream) -> Option<Vec<Operation>> {
    let bytes = stream.decompressed_content().ok().or_else(|| stream.dict.get(b"Filter").is_err().then(|| stream.content.clone()))?;
    let ops = Content::decode(&bytes).ok()?.operations;
    // An inline image lopdf couldn't read comes back empty and would be lost when written again.
    (!ops.iter().any(|o| o.operator == "BI" && o.operands.is_empty())).then_some(ops)
}

fn encode(ops: &[Operation]) -> Vec<u8> {
    Content { operations: ops }.encode().unwrap_or_default()
}

// ---- images -------------------------------------------------------------------

/// Pixel rectangles [col0, row0, col1, row1) of a w×h image drawn through `ctm` that lie under the areas.
fn pixel_rects(ctm: Matrix, w: usize, h: usize, areas: &[Bounds]) -> Vec<[usize; 4]> {
    let Some(inv) = ctm.invert() else { return Vec::new() };
    let (wf, hf) = (w as f64, h as f64);
    let mut out = Vec::new();
    for a in areas {
        let b = Bounds::around(inv, a.x0, a.y0, a.x1, a.y1);
        if !(b.x1 > 0.0 && b.x0 < 1.0 && b.y1 > 0.0 && b.y0 < 1.0) {
            continue;
        }
        // One pixel more on each side: resampling smears edge pixels into view.
        let clamp = |v: f64, max: f64| v.clamp(0.0, max) as usize;
        let r = [
            clamp((b.x0 * wf).floor() - 1.0, wf),
            clamp(((1.0 - b.y1) * hf).floor() - 1.0, hf),
            clamp((b.x1 * wf).ceil() + 1.0, wf),
            clamp(((1.0 - b.y0) * hf).ceil() + 1.0, hf),
        ];
        if r[0] < r[2] && r[1] < r[3] {
            out.push(r);
        }
    }
    out
}

/// Clears the samples of the pixels in `rects` in raw image data.
fn clear_samples(data: &mut [u8], w: usize, bits_per_pixel: usize, rects: &[[usize; 4]]) {
    let row_bytes = (w * bits_per_pixel).div_ceil(8);
    for r in rects {
        for row in r[1]..r[3] {
            let base = row * row_bytes * 8;
            let (from, to) = (base + r[0] * bits_per_pixel, base + r[2] * bits_per_pixel);
            for bit in from..to.min(data.len() * 8) {
                data[bit / 8] &= !(0x80 >> (bit % 8));
            }
        }
    }
}

fn components(doc: &Document, cs: &Object) -> Option<usize> {
    match deref(doc, cs) {
        Object::Name(n) => match n.as_slice() {
            b"DeviceGray" | b"CalGray" | b"G" => Some(1),
            b"DeviceRGB" | b"CalRGB" | b"RGB" => Some(3),
            b"DeviceCMYK" | b"CMYK" => Some(4),
            _ => None,
        },
        Object::Array(a) => match a.first().and_then(|o| o.as_name().ok())? {
            b"Indexed" | b"I" | b"Separation" | b"CalGray" => Some(1),
            b"CalRGB" | b"Lab" => Some(3),
            b"DeviceN" => a.get(1).map(|o| deref(doc, o)).and_then(|o| o.as_array().ok()).map(Vec::len),
            b"ICCBased" => deref(doc, a.get(1)?).as_stream().ok()?.dict.get(b"N").ok().and_then(number).map(|n| n as usize),
            _ => None,
        },
        _ => None,
    }
}

/// Clears the pixels of an image XObject under the areas. Ok(false) when none are.
fn mask_image(doc: &Document, image: &mut Stream, ctm: Matrix, areas: &[Bounds]) -> Result<bool, &'static str> {
    let dict = &image.dict;
    let size = |key: &[u8]| dict.get(key).ok().and_then(number).filter(|v| *v >= 1.0).map(|v| v as usize);
    let (Some(w), Some(h)) = (size(b"Width"), size(b"Height")) else { return Err("an image without a size") };
    let rects = pixel_rects(ctm, w, h, areas);
    if rects.is_empty() {
        return Ok(false);
    }
    let is_mask = dict.get(b"ImageMask").and_then(Object::as_bool).unwrap_or(false);
    let bpc = if is_mask { 1 } else { size(b"BitsPerComponent").ok_or("an image without a sample size")? };
    let comps = if is_mask {
        1
    } else {
        dict.get(b"ColorSpace").ok().and_then(|cs| components(doc, cs)).ok_or("an image in a color space that can't be rewritten")?
    };
    let filters: Vec<Vec<u8>> = match dict.get(b"Filter").map(|o| deref(doc, o)) {
        Ok(Object::Name(n)) => vec![n.clone()],
        Ok(Object::Array(a)) => a.iter().filter_map(|o| o.as_name().ok().map(<[u8]>::to_vec)).collect(),
        _ => Vec::new(),
    };
    let lossless =
        |f: &Vec<u8>| matches!(f.as_slice(), b"FlateDecode" | b"LZWDecode" | b"ASCII85Decode" | b"ASCIIHexDecode" | b"RunLengthDecode");
    if filters.iter().all(lossless) {
        let mut raw = image.decompressed_content_with_limit(MAX_IMAGE_BYTES).map_err(|_| "an image that couldn't be read")?;
        if raw.len() < (w * comps * bpc).div_ceil(8) * h {
            return Err("an image that couldn't be read");
        }
        clear_samples(&mut raw, w, comps * bpc, &rects);
        image.set_plain_content(raw);
        let _ = image.compress();
        return Ok(true);
    }
    if filters.len() != 1 || filters[0] != b"DCTDecode" || !(comps == 1 || comps == 3) || dict.has(b"Decode") {
        return Err("an image encoding that can't be rewritten");
    }
    let decoded =
        image::load_from_memory_with_format(&image.content, image::ImageFormat::Jpeg).map_err(|_| "an image that couldn't be read")?;
    if decoded.width() as usize != w || decoded.height() as usize != h {
        return Err("an image that couldn't be read");
    }
    let gray = comps == 1;
    let (mut pixels, channels) = if gray { (decoded.to_luma8().into_raw(), 1) } else { (decoded.to_rgb8().into_raw(), 3) };
    clear_samples(&mut pixels, w, channels * 8, &rects);
    let out = if gray {
        DynamicImage::ImageLuma8(image::GrayImage::from_raw(w as u32, h as u32, pixels).ok_or("an image that couldn't be read")?)
    } else {
        DynamicImage::ImageRgb8(image::RgbImage::from_raw(w as u32, h as u32, pixels).ok_or("an image that couldn't be read")?)
    };
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&out).map_err(|_| "an image that couldn't be written")?;
    image.dict.set("ColorSpace", if gray { "DeviceGray" } else { "DeviceRGB" });
    image.dict.set("BitsPerComponent", 8);
    image.dict.remove(b"DecodeParms");
    image.set_content(jpeg);
    image.allows_compression = false;
    Ok(true)
}

/// Clears the pixels of an inline image (lopdf reads only unfiltered ones) under the areas.
fn mask_inline(image: &mut Stream, ctm: Matrix, areas: &[Bounds]) -> Result<bool, &'static str> {
    let d = &image.dict;
    let get = |short: &[u8], long: &[u8]| d.get(short).or_else(|_| d.get(long)).ok().cloned();
    let size = |short: &[u8], long: &[u8]| get(short, long).as_ref().and_then(number).filter(|v| *v >= 1.0).map(|v| v as usize);
    let (Some(w), Some(h)) = (size(b"W", b"Width"), size(b"H", b"Height")) else { return Err("an image without a size") };
    let is_mask = get(b"IM", b"ImageMask").and_then(|o| o.as_bool().ok()).unwrap_or(false);
    let bpc = if is_mask { 1 } else { size(b"BPC", b"BitsPerComponent").ok_or("an image without a sample size")? };
    let comps = if is_mask {
        1
    } else {
        match get(b"CS", b"ColorSpace") {
            Some(Object::Name(n)) => match n.as_slice() {
                b"G" | b"DeviceGray" => 1,
                b"RGB" | b"DeviceRGB" => 3,
                b"CMYK" | b"DeviceCMYK" => 4,
                _ => return Err("an image in a color space that can't be rewritten"),
            },
            Some(Object::Array(_)) => 1,
            _ => return Err("an image in a color space that can't be rewritten"),
        }
    };
    let rects = pixel_rects(ctm, w, h, areas);
    if rects.is_empty() {
        return Ok(false);
    }
    clear_samples(&mut image.content, w, comps * bpc, &rects);
    Ok(true)
}

// ---- pages --------------------------------------------------------------------

/// What redacting a page did.
#[derive(Default, Debug)]
pub struct Outcome {
    /// Annotations taken off the page (form fields among them must leave the form too).
    pub removed: Vec<ObjectId>,
    /// Why the page's content must be replaced by a picture, if it must.
    pub issue: Option<String>,
}

fn page_areas(page: &Dictionary, areas: &[Area]) -> Vec<Bounds> {
    let Some(view) = visible_box(page) else { return Vec::new() };
    areas
        .iter()
        .filter(|a| a.w > 0.0 && a.h > 0.0 && a.x.is_finite() && a.y.is_finite())
        .map(|a| Bounds { x0: view[0] + a.x, y0: view[3] - a.y - a.h, x1: view[0] + a.x + a.w, y1: view[3] - a.y })
        .collect()
}

fn content_refs(page: &Dictionary) -> Vec<Object> {
    match page.get(b"Contents") {
        Ok(Object::Array(items)) => items.clone(),
        Ok(other) => vec![other.clone()],
        Err(_) => Vec::new(),
    }
}

/// The page's content streams joined, or None when one can't be read.
fn page_content(doc: &Document, page: &Dictionary) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for r in content_refs(page) {
        let stream = deref(doc, &r).as_stream().ok()?;
        out.extend(stream.decompressed_content().ok().or_else(|| stream.dict.get(b"Filter").is_err().then(|| stream.content.clone()))?);
        out.push(b'\n');
    }
    Some(out)
}

/// Black boxes over the areas, drawn in default user space.
fn boxes(areas: &[Bounds]) -> String {
    let mut s = String::from("q 0 g\n");
    for a in areas {
        s += &format!("{:.3} {:.3} {:.3} {:.3} re\n", a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
    }
    s + "f\nQ\n"
}

/// Redacts the page in `dict` (not yet in the document). With `content` false
/// only annotations go and the boxes are drawn: the content was already
/// replaced by a picture.
pub fn apply(doc: &mut Document, dict: &mut Dictionary, areas: &[Area], content: bool) -> AppResult<Outcome> {
    let areas = page_areas(dict, areas);
    if areas.is_empty() {
        return Ok(Outcome::default());
    }
    let mut r = Redactor { doc: &mut *doc, areas: areas.clone(), fonts: HashMap::new(), issue: None };
    let mut rewritten: Option<Vec<u8>> = None;
    if content {
        let ops = page_content(r.doc, dict).and_then(|bytes| {
            let ops = Content::decode(&bytes).ok()?.operations;
            (!ops.iter().any(|o| o.operator == "BI" && o.operands.is_empty())).then_some(ops)
        });
        match ops {
            Some(ops) => {
                let mut res = dict_at(r.doc, dict, b"Resources").unwrap_or_default();
                let (ops, _) = r.process(ops, &mut res, Matrix::IDENTITY, 0);
                // Close what the content left open, so the boxes are drawn in default user space.
                let mut depth: i64 = 0;
                for op in &ops {
                    match op.operator.as_str() {
                        "q" => depth += 1,
                        "Q" => depth = (depth - 1).max(0),
                        _ => {}
                    }
                }
                let mut bytes = b"q\n".to_vec();
                bytes.extend(encode(&ops));
                bytes.extend("\nQ".repeat(depth as usize + 1).into_bytes());
                bytes.push(b'\n');
                dict.set("Resources", res);
                rewritten = Some(bytes);
            }
            None => r.flag("content that couldn't be read"),
        }
    }
    let issue = r.issue.take();
    let painted = boxes(&areas);
    match rewritten {
        Some(mut bytes) => {
            bytes.extend(painted.into_bytes());
            let mut stream = Stream::new(Dictionary::new(), bytes);
            let _ = stream.compress();
            dict.set("Contents", doc.add_object(stream));
        }
        None => {
            // The content stays as it is (it becomes a picture, or already is one); the boxes go on top.
            let open = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
            let close = doc.add_object(Stream::new(Dictionary::new(), format!("\nQ\n{painted}").into_bytes()));
            let mut contents = vec![Object::Reference(open)];
            contents.extend(content_refs(dict));
            contents.push(Object::Reference(close));
            dict.set("Contents", contents);
        }
    }
    // An embedded thumbnail and application data still show the old page.
    dict.remove(b"Thumb");
    dict.remove(b"PieceInfo");
    let removed = remove_annotations(doc, dict, &areas);
    Ok(Outcome { removed, issue })
}

/// Takes annotations touching an area off the page, with their pop-ups and replies.
fn remove_annotations(doc: &Document, page: &mut Dictionary, areas: &[Bounds]) -> Vec<ObjectId> {
    let items = match page.get(b"Annots") {
        Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
        Ok(Object::Array(a)) => a.clone(),
        _ => return Vec::new(),
    };
    let annot = |o: &Object| deref(doc, o).as_dict().ok().cloned();
    let rect = |d: &Dictionary| {
        let v: Vec<f64> = d.get(b"Rect").and_then(Object::as_array).map(|a| a.iter().filter_map(number).collect()).unwrap_or_default();
        match v[..] {
            [a, b, c, e] => Some(Bounds { x0: a.min(c), y0: b.min(e), x1: a.max(c), y1: b.max(e) }),
            _ => None,
        }
    };
    let mut gone: Vec<bool> = items.iter().map(|o| annot(o).and_then(|d| rect(&d)).is_some_and(|b| touches_any(&b, areas))).collect();
    let ids: Vec<Option<ObjectId>> = items.iter().map(|o| o.as_reference().ok()).collect();
    loop {
        let removed: HashSet<ObjectId> = ids.iter().zip(&gone).filter(|(_, g)| **g).filter_map(|(id, _)| *id).collect();
        let mut more = false;
        for (i, o) in items.iter().enumerate() {
            if gone[i] {
                continue;
            }
            let Some(d) = annot(o) else { continue };
            let linked =
                [&b"Parent"[..], b"IRT"].iter().any(|k| d.get(k).and_then(Object::as_reference).is_ok_and(|p| removed.contains(&p)));
            if linked {
                gone[i] = true;
                more = true;
            }
        }
        if !more {
            break;
        }
    }
    let kept: Vec<Object> = items.iter().zip(&gone).filter(|(_, g)| !**g).map(|(o, _)| o.clone()).collect();
    let removed = ids.iter().zip(&gone).filter(|(_, g)| **g).filter_map(|(id, _)| *id).collect();
    if kept.len() != items.len() {
        page.set("Annots", kept);
    }
    removed
}

/// Replaces the page's content with a picture of it (a JPEG rendered with the areas already black).
pub fn rasterize(doc: &mut Document, dict: &mut Dictionary, image: &Path) -> AppResult<()> {
    let bytes = std::fs::read(image)?;
    let decoder = image::codecs::jpeg::JpegDecoder::new(Cursor::new(&bytes))?;
    let (w, h) = decoder.dimensions();
    let cs = match decoder.original_color_type() {
        image::ExtendedColorType::L8 => "DeviceGray",
        image::ExtendedColorType::Rgb8 => "DeviceRGB",
        _ => return Err(AppError::msg("The page picture must be a gray or RGB JPEG")),
    };
    let view = visible_box(dict).ok_or_else(|| AppError::msg("The page has no size"))?;
    let mut picture = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => w as i64,
            "Height" => h as i64,
            "ColorSpace" => cs,
            "BitsPerComponent" => 8,
            "Filter" => "DCTDecode",
        },
        bytes,
    );
    picture.allows_compression = false;
    let id = doc.add_object(picture);
    let [x0, y0, x1, y1] = view;
    let draw = format!("q {:.4} 0 0 {:.4} {x0:.4} {y0:.4} cm /{PICTURE} Do Q\n", x1 - x0, y1 - y0);
    dict.set("Contents", doc.add_object(Stream::new(Dictionary::new(), draw.into_bytes())));
    let mut xobjects = Dictionary::new();
    xobjects.set(PICTURE, id);
    let mut res = Dictionary::new();
    res.set("XObject", xobjects);
    dict.set("Resources", res);
    for key in [&b"Thumb"[..], b"PieceInfo", b"Group"] {
        dict.remove(key);
    }
    Ok(())
}

/// Takes removed widgets (and fields left without any) out of the document's form.
pub fn prune_fields(doc: &mut Document, catalog_id: ObjectId, removed: &HashSet<ObjectId>) -> AppResult<()> {
    let Ok(form) = doc.get_dictionary(catalog_id)?.get(b"AcroForm").cloned() else { return Ok(()) };
    let (form_id, mut form) = match form {
        Object::Reference(id) => (Some(id), doc.get_dictionary(id)?.clone()),
        Object::Dictionary(d) => (None, d),
        _ => return Ok(()),
    };
    let Ok(fields) = form.get(b"Fields").map(|o| deref(doc, o).clone()).and_then(|o| o.as_array().cloned()) else { return Ok(()) };
    /// False when the field is gone: its widget removed, or all its kids gone.
    fn keep(doc: &mut Document, field: &Object, removed: &HashSet<ObjectId>, depth: usize) -> bool {
        let Ok(id) = field.as_reference() else { return true };
        if removed.contains(&id) {
            return false;
        }
        let Ok(kids) = doc.get_dictionary(id).and_then(|d| d.get(b"Kids")).and_then(Object::as_array).cloned() else { return true };
        if depth > 32 {
            return true;
        }
        let left: Vec<Object> = kids.iter().filter(|k| keep(doc, k, removed, depth + 1)).cloned().collect();
        if left.len() == kids.len() {
            return true;
        }
        if left.is_empty() {
            return false;
        }
        if let Ok(d) = doc.get_dictionary_mut(id) {
            d.set("Kids", left);
        }
        true
    }
    let left: Vec<Object> = fields.iter().filter(|f| keep(doc, f, removed, 0)).cloned().collect();
    if left.len() == fields.len() {
        return Ok(());
    }
    form.set("Fields", left);
    match form_id {
        Some(id) => {
            doc.objects.insert(id, Object::Dictionary(form));
        }
        None => doc.get_dictionary_mut(catalog_id)?.set("AcroForm", form),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Text shown on the page by its Tj/TJ operators, in order.
    fn shown_text(doc: &Document, page: &Dictionary) -> String {
        let bytes = page_content(doc, page).unwrap();
        let mut s = String::new();
        for op in Content::decode(&bytes).unwrap().operations {
            let parts: Vec<Object> = match (op.operator.as_str(), op.operands.as_slice()) {
                ("TJ", [Object::Array(a)]) => a.clone(),
                ("Tj", [x]) => vec![x.clone()],
                _ => continue,
            };
            for p in parts {
                if let Object::String(b, _) = p {
                    s += &String::from_utf8_lossy(&b);
                }
            }
            s.push('|');
        }
        s
    }

    /// A page with one line in a font with known widths (every glyph 500 units wide, 10 pt).
    fn text_page(doc: &mut Document, line: &str, widths: bool) -> Dictionary {
        // Not one of the standard fonts, whose widths are known without a table.
        let mut font = dictionary! { "Type" => "Font", "Subtype" => "TrueType", "BaseFont" => "Calibri" };
        if widths {
            font.set("FirstChar", 32);
            font.set("Widths", (32..127).map(|_| Object::Integer(500)).collect::<Vec<_>>());
        }
        let font = doc.add_object(font);
        let content = format!("BT /F1 10 Tf 100 700 Td ({line}) Tj ET\n0 0 1 rg 300 300 20 20 re f\n");
        let content = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        dictionary! {
            "Type" => "Page",
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        }
    }

    /// Page-space area (top-left origin) over user-space x0..x1 at the line's height (y 700).
    fn over(x0: f64, x1: f64) -> Area {
        Area { x: x0, y: 792.0 - 712.0, w: x1 - x0, h: 15.0 }
    }

    #[test]
    fn removes_glyphs_and_keeps_the_rest_in_place() {
        let mut doc = Document::with_version("1.5");
        let mut page = text_page(&mut doc, "NIK 3201234567", true);
        // Each glyph is 5 pt wide: "NIK " spans 100..120, the number 120..170.
        let out = apply(&mut doc, &mut page, &[over(119.0, 171.0)], true).unwrap();
        assert!(out.issue.is_none());
        assert_eq!(shown_text(&doc, &page), "NIK |");
        let bytes = page_content(&doc, &page).unwrap();
        let ops = Content::decode(&bytes).unwrap().operations;
        let tj = ops.iter().find(|o| o.operator == "TJ").unwrap();
        // The removed digits' advance stays, so whatever follows doesn't move: 10 glyphs × 5 pt at 10 pt = -5000.
        let Object::Array(items) = &tj.operands[0] else { panic!() };
        assert!(items.last().and_then(number).is_some_and(|v| (v + 5000.0).abs() < 0.5), "{items:?}");
        // A black box is painted over the area.
        assert!(String::from_utf8_lossy(&bytes).contains("119.000 697.000 52.000 15.000 re"));
    }

    #[test]
    fn leaves_text_outside_the_areas() {
        let mut doc = Document::with_version("1.5");
        let mut page = text_page(&mut doc, "Hello world", true);
        let out = apply(&mut doc, &mut page, &[Area { x: 400.0, y: 400.0, w: 50.0, h: 50.0 }], true).unwrap();
        assert!(out.issue.is_none());
        assert_eq!(shown_text(&doc, &page), "Hello world|");
    }

    #[test]
    fn removes_shapes_inside_an_area() {
        let mut doc = Document::with_version("1.5");
        let mut page = text_page(&mut doc, "x", true);
        // The blue square at 300,300 (page-space y 472..492).
        apply(&mut doc, &mut page, &[Area { x: 295.0, y: 467.0, w: 30.0, h: 30.0 }], true).unwrap();
        let text = String::from_utf8_lossy(&page_content(&doc, &page).unwrap()).into_owned();
        assert!(!text.contains("300 300 20 20 re"), "{text}");
    }

    #[test]
    fn asks_for_a_picture_when_widths_are_unknown() {
        let mut doc = Document::with_version("1.5");
        let mut page = text_page(&mut doc, "Secret", false);
        let out = apply(&mut doc, &mut page, &[over(99.0, 140.0)], true).unwrap();
        assert!(out.issue.is_some());
        // Elsewhere on the page the same font doesn't matter.
        let mut page = text_page(&mut doc, "Secret", false);
        let out = apply(&mut doc, &mut page, &[Area { x: 10.0, y: 10.0, w: 20.0, h: 20.0 }], true).unwrap();
        assert!(out.issue.is_none());
    }

    #[test]
    fn clears_pixels_under_an_area() {
        let mut doc = Document::with_version("1.5");
        let (w, h) = (100usize, 100usize);
        let image = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64, "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8 },
            vec![200u8; w * h],
        ));
        // Drawn 100×100 pt at the page's bottom-left corner.
        let content = doc.add_object(Stream::new(dictionary! {}, b"q 100 0 0 100 0 0 cm /Im1 Do Q".to_vec()));
        let mut page = dictionary! {
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im1" => image } },
        };
        // The image's top-left quarter: user space x 0..50, y 50..100.
        apply(&mut doc, &mut page, &[Area { x: 0.0, y: 692.0, w: 50.0, h: 50.0 }], true).unwrap();
        let res = page.get(b"Resources").unwrap().as_dict().unwrap();
        let id = res.get(b"XObject").unwrap().as_dict().unwrap().get(b"Im1").unwrap().as_reference().unwrap();
        assert_ne!(id, image, "a changed copy, the original may be shared");
        let pixels = doc.get_object(id).unwrap().as_stream().unwrap().decompressed_content().unwrap();
        assert_eq!(pixels[10 * w + 10], 0);
        assert_eq!(pixels[90 * w + 90], 200);
        assert_eq!(pixels[10 * w + 90], 200);
    }

    #[test]
    fn rewrites_jpeg_photos() {
        let mut doc = Document::with_version("1.5");
        let photo = image::RgbImage::from_pixel(80, 40, image::Rgb([230, 200, 40]));
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&photo).unwrap();
        let image = doc.add_object(Stream::new(
            dictionary! { "Subtype" => "Image", "Width" => 80, "Height" => 40, "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8, "Filter" => "DCTDecode" },
            jpeg,
        ));
        // Drawn 160×80 pt at (100, 100).
        let content = doc.add_object(Stream::new(dictionary! {}, b"q 160 0 0 80 100 100 cm /Im1 Do Q".to_vec()));
        let mut page = dictionary! {
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im1" => image } },
        };
        // The photo's left half: user space x 100..180, y 100..180.
        let out = apply(&mut doc, &mut page, &[Area { x: 100.0, y: 612.0, w: 80.0, h: 80.0 }], true).unwrap();
        assert!(out.issue.is_none());
        let res = page.get(b"Resources").unwrap().as_dict().unwrap();
        let id = res.get(b"XObject").unwrap().as_dict().unwrap().get(b"Im1").unwrap().as_reference().unwrap();
        let stream = doc.get_object(id).unwrap().as_stream().unwrap();
        let back = image::load_from_memory(&stream.content).unwrap().to_rgb8();
        assert!(back.get_pixel(10, 20).0.iter().all(|&v| v < 30), "{:?}", back.get_pixel(10, 20));
        assert!(back.get_pixel(70, 20).0[0] > 200);
    }

    #[test]
    fn knows_the_standard_fonts_without_a_width_table() {
        let mut doc = Document::with_version("1.5");
        let font = doc
            .add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding" });
        let f = Font::load(&doc, doc.get_dictionary(font).unwrap());
        assert!(f.known);
        // Helvetica: "i" is 222/1000 em, "W" 944.
        assert!((f.width(u32::from(b'i')) - 0.222).abs() < 1e-9 && (f.width(u32::from(b'W')) - 0.944).abs() < 1e-9);
        assert!(
            matches!(standard_font(b"ABCDEF+Arial,BoldItalic"), Some(Standard::Table(t, _)) if std::ptr::eq(t, crate::pdf::std14::HELVETICA_BOLD))
        );
        assert!(
            matches!(standard_font(b"TimesNewRomanPS-ItalicMT"), Some(Standard::Table(t, _)) if std::ptr::eq(t, crate::pdf::std14::TIMES_ITALIC))
        );
        assert!(standard_font(b"Calibri").is_none());
    }

    #[test]
    fn removes_annotations_and_their_popups() {
        let mut doc = Document::with_version("1.5");
        let mut page = text_page(&mut doc, "x", true);
        let link = doc.add_object(dictionary! { "Subtype" => "Link", "Rect" => vec![100.into(), 690.into(), 160.into(), 710.into()] });
        let popup = doc.add_object(
            dictionary! { "Subtype" => "Popup", "Parent" => link, "Rect" => vec![400.into(), 400.into(), 500.into(), 500.into()] },
        );
        let other = doc.add_object(dictionary! { "Subtype" => "Link", "Rect" => vec![10.into(), 10.into(), 20.into(), 20.into()] });
        page.set("Annots", vec![link.into(), popup.into(), other.into()]);
        let out = apply(&mut doc, &mut page, &[over(99.0, 171.0)], true).unwrap();
        assert_eq!(out.removed, vec![link, popup]);
        assert_eq!(page.get(b"Annots").unwrap().as_array().unwrap(), &vec![Object::Reference(other)]);
    }

    #[test]
    fn a_page_that_cant_be_taken_apart_is_saved_as_a_picture() {
        use crate::pdf::tests::temp_dir;
        use crate::pdf::{AssembleJob, Options, PageRef, Source, assemble};
        let dir = temp_dir();
        // The sample's font, renamed to one whose widths are unknown without a table.
        let mut sample = crate::pdf::tests::sample(&["A1", "A2"]);
        for o in sample.objects.values_mut() {
            if let Ok(d) = o.as_dict_mut()
                && d.has(b"BaseFont")
            {
                d.set("BaseFont", "Calibri");
            }
        }
        let a = dir.join("a.pdf").display().to_string();
        sample.save(&a).unwrap();
        let out = dir.join("out.pdf").display().to_string();
        let area = Area { x: 60.0, y: 792.0 - 750.0, w: 100.0, h: 50.0 };
        let page = |index, redact: Vec<Area>, raster: Option<String>| PageRef {
            source: "a".into(),
            index,
            rotate: 0,
            sheet: None,
            comments: None,
            redact,
            raster,
        };
        let mut job = AssembleJob {
            sources: vec![Source { id: "a".into(), path: a, password: None }],
            pages: vec![page(0, vec![area], None), page(1, Vec::new(), None)],
            output: out.clone(),
            options: Options::default(),
            outline: None,
        };
        let res = assemble(&job).unwrap();
        assert_eq!((res.redacted, res.raster_needed.clone()), (1, vec![0]));

        let picture = dir.join("page.jpg");
        image::RgbImage::from_pixel(85, 110, image::Rgb([255, 255, 255])).save(&picture).unwrap();
        job.pages[0] = page(0, vec![area], Some(picture.display().to_string()));
        let res = assemble(&job).unwrap();
        assert!(res.raster_needed.is_empty());
        let doc = Document::load(&out).unwrap();
        let first = *doc.get_pages().get(&1).unwrap();
        let text = String::from_utf8_lossy(&doc.get_page_content(first)).into_owned();
        assert!(!text.contains("A1") && text.contains(PICTURE), "{text}");
        let second = *doc.get_pages().get(&2).unwrap();
        assert!(String::from_utf8_lossy(&doc.get_page_content(second)).contains("A2"));
        let info = doc.trailer.get(b"Info").and_then(|o| doc.dereference(o)).unwrap().1.as_dict().unwrap();
        let note = crate::pdf::text_string(&doc, info.get(b"Redacted").unwrap()).unwrap();
        assert!(
            note.starts_with("Some parts of this file were blacked out with KlikPaper") && note.contains("the 1 black box was"),
            "{note}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn matrices_invert() {
        let m = Matrix([2.0, 0.5, -1.0, 3.0, 10.0, 20.0]);
        let (x, y) = m.apply(3.0, 4.0);
        let (bx, by) = m.invert().unwrap().apply(x, y);
        assert!((bx - 3.0).abs() < 1e-9 && (by - 4.0).abs() < 1e-9);
    }
}
