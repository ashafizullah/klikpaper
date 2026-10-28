//! Cleaning up scanned pages. The frontend draws the page as a picture; here
//! it is straightened (the skew of its lines of text is measured and undone),
//! dark bands along the edges (the scanner lid, a table under a phone photo)
//! are whitened, and it can be turned into black and white with a threshold
//! that follows the local brightness, so shadows and uneven light don't turn
//! into black patches. The page then shows the cleaned picture instead of its
//! old content.
use super::sheet::visible_box;
use crate::error::{AppError, AppResult};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GrayImage, RgbImage};
use lopdf::{Dictionary, Document, Object, Stream, dictionary};
use serde::Deserialize;
use std::path::Path;

const PICTURE: &str = "KlikPaperScan";
/// Skew beyond this is taken to be on purpose (or not a page of text).
const MAX_SKEW: f64 = 6.0;
/// Edge bands at most this share of the width or height are whitened.
const MAX_BAND: f64 = 0.15;

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    /// A PNG of the page, unrotated, covering its visible box.
    pub path: String,
    #[serde(default)]
    pub deskew: bool,
    #[serde(default)]
    pub borders: bool,
    #[serde(default)]
    pub black_white: bool,
}

/// Otsu's threshold of a gray image: the level that best splits it into ink (at or below it) and paper.
fn otsu(gray: &GrayImage) -> u8 {
    let mut hist = [0u64; 256];
    for p in gray.pixels() {
        hist[p.0[0] as usize] += 1;
    }
    let total: u64 = hist.iter().sum();
    let sum: f64 = hist.iter().enumerate().map(|(i, &n)| i as f64 * n as f64).sum();
    let (mut weight, mut acc, mut best, mut level) = (0u64, 0.0, 0.0, 128u8);
    for (t, &n) in hist.iter().enumerate() {
        weight += n;
        if weight == 0 || weight == total {
            continue;
        }
        acc += t as f64 * n as f64;
        let (w0, w1) = (weight as f64, (total - weight) as f64);
        let (m0, m1) = (acc / w0, (sum - acc) / w1);
        let between = w0 * w1 * (m0 - m1).powi(2);
        if between > best {
            best = between;
            level = t as u8;
        }
    }
    level
}

/// The angle (degrees, counter-clockwise) the lines of text are tilted by: the
/// one at which ink lines up best into rows (the row counts vary the most).
pub fn skew_angle(gray: &GrayImage) -> f64 {
    // A smaller copy is plenty to find the angle.
    let scale = (1200.0 / gray.width().max(gray.height()) as f64).min(1.0);
    let small = if scale < 1.0 {
        image::imageops::resize(
            gray,
            (gray.width() as f64 * scale) as u32,
            (gray.height() as f64 * scale) as u32,
            image::imageops::FilterType::Triangle,
        )
    } else {
        gray.clone()
    };
    let level = otsu(&small);
    let (w, h) = small.dimensions();
    let mut ink: Vec<(f64, f64)> = Vec::new();
    for (x, y, p) in small.enumerate_pixels() {
        // Leave out a margin, where scanner edges are.
        if p.0[0] <= level && x > w / 20 && x < w - w / 20 && y > h / 20 && y < h - h / 20 {
            ink.push((x as f64, y as f64));
        }
    }
    if ink.len() < 200 {
        return 0.0;
    }
    let step = (ink.len() / 150_000).max(1);
    let ink: Vec<(f64, f64)> = ink.into_iter().step_by(step).collect();
    let score = |deg: f64| {
        let (s, c) = deg.to_radians().sin_cos();
        let rows = (w + h) as usize * 2;
        let mut count = vec![0u32; rows];
        for &(x, y) in &ink {
            let r = (y * c + x * s) as isize + (rows / 2) as isize;
            if r >= 0 && (r as usize) < rows {
                count[r as usize] += 1;
            }
        }
        count.iter().map(|&n| (n as f64).powi(2)).sum::<f64>()
    };
    let best = |from: f64, to: f64, step: f64| {
        let mut at = from;
        let (mut top, mut top_score) = (0.0, f64::MIN);
        while at <= to + 1e-9 {
            let s = score(at);
            if s > top_score {
                top_score = s;
                top = at;
            }
            at += step;
        }
        top
    };
    let coarse = best(-MAX_SKEW, MAX_SKEW, 0.25);
    let fine = best(coarse - 0.25, coarse + 0.25, 0.05);
    if fine.abs() < 0.1 { 0.0 } else { fine }
}

/// Turns an image by `deg` degrees about its center (bilinear), filling with white.
fn rotate<const N: usize>(src: &[u8], w: u32, h: u32, deg: f64) -> Vec<u8> {
    let (s, c) = deg.to_radians().sin_cos();
    let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
    let mut out = vec![255u8; src.len()];
    let at = |x: i64, y: i64, ch: usize| -> f64 {
        if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 { 255.0 } else { src[(y as usize * w as usize + x as usize) * N + ch] as f64 }
    };
    for y in 0..h {
        for x in 0..w {
            // Where this output pixel comes from in the source.
            let (dx, dy) = (x as f64 - cx, y as f64 - cy);
            let sx = dx * c - dy * s + cx;
            let sy = dx * s + dy * c + cy;
            let (x0, y0) = (sx.floor() as i64, sy.floor() as i64);
            let (fx, fy) = (sx - x0 as f64, sy - y0 as f64);
            for ch in 0..N {
                let v = at(x0, y0, ch) * (1.0 - fx) * (1.0 - fy)
                    + at(x0 + 1, y0, ch) * fx * (1.0 - fy)
                    + at(x0, y0 + 1, ch) * (1.0 - fx) * fy
                    + at(x0 + 1, y0 + 1, ch) * fx * fy;
                out[(y as usize * w as usize + x as usize) * N + ch] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Dark areas reaching in from the edges (the scanner lid, a table under a
/// phone photo, the wedges a tilted scan leaves): dark pixels connected to the
/// image border, followed no further than a band along the edges so the page
/// itself is left alone, then grown a little over their soft rim.
fn edge_dark(gray: &GrayImage) -> Vec<bool> {
    let (w, h) = (gray.width() as usize, gray.height() as usize);
    let level = otsu(gray).clamp(60, 140);
    let band = ((w.min(h) as f64) * MAX_BAND) as usize;
    let near_edge = |x: usize, y: usize| x < band || y < band || x >= w - band || y >= h - band;
    let dark = |x: usize, y: usize| gray.get_pixel(x as u32, y as u32).0[0] <= level;
    let mut out = vec![false; w * h];
    let mut queue: Vec<(usize, usize)> = Vec::new();
    for x in 0..w {
        queue.push((x, 0));
        queue.push((x, h - 1));
    }
    for y in 0..h {
        queue.push((0, y));
        queue.push((w - 1, y));
    }
    while let Some((x, y)) = queue.pop() {
        let i = y * w + x;
        if out[i] || !dark(x, y) || !near_edge(x, y) {
            continue;
        }
        out[i] = true;
        if x > 0 {
            queue.push((x - 1, y));
        }
        if x + 1 < w {
            queue.push((x + 1, y));
        }
        if y > 0 {
            queue.push((x, y - 1));
        }
        if y + 1 < h {
            queue.push((x, y + 1));
        }
    }
    // A few pixels more over the antialiased rim.
    let grow = (w.max(h) / 600).max(2);
    let mut grown = out.clone();
    for y in 0..h {
        for x in 0..w {
            if !out[y * w + x] {
                continue;
            }
            for yy in y.saturating_sub(grow)..(y + grow + 1).min(h) {
                for xx in x.saturating_sub(grow)..(x + grow + 1).min(w) {
                    grown[yy * w + xx] = true;
                }
            }
        }
    }
    grown
}

/// Black and white with Sauvola's threshold: a pixel is ink when darker than its
/// surroundings' mean, lowered where the surroundings vary little (plain paper).
fn black_white(gray: &GrayImage) -> Vec<bool> {
    let (w, h) = (gray.width() as usize, gray.height() as usize);
    // Sauvola alone hollows out large dark areas (a stamp, a logo, a black box): what is
    // clearly dark stays ink whatever its surroundings.
    let solid = {
        // A third of the way from the ink's mean brightness to the paper's.
        let level = otsu(gray);
        let (mut ink, mut paper) = ((0f64, 0f64), (0f64, 0f64));
        for p in gray.pixels() {
            let v = p.0[0] as f64;
            let class = if p.0[0] <= level { &mut ink } else { &mut paper };
            class.0 += v;
            class.1 += 1.0;
        }
        let (ink, paper) = (ink.0 / ink.1.max(1.0), paper.0 / paper.1.max(1.0));
        ink + (paper - ink) * 0.35
    };
    let radius = (w.max(h) / 160).max(7);
    let mut sum = vec![0u64; (w + 1) * (h + 1)];
    let mut sq = vec![0u64; (w + 1) * (h + 1)];
    for y in 0..h {
        let (mut row, mut row_sq) = (0u64, 0u64);
        for x in 0..w {
            let v = gray.get_pixel(x as u32, y as u32).0[0] as u64;
            row += v;
            row_sq += v * v;
            sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
            sq[(y + 1) * (w + 1) + x + 1] = sq[y * (w + 1) + x + 1] + row_sq;
        }
    }
    let mut ink = vec![false; w * h];
    for y in 0..h {
        let (y0, y1) = (y.saturating_sub(radius), (y + radius + 1).min(h));
        for x in 0..w {
            let (x0, x1) = (x.saturating_sub(radius), (x + radius + 1).min(w));
            let n = ((y1 - y0) * (x1 - x0)) as f64;
            let area = |t: &[u64]| (t[y1 * (w + 1) + x1] + t[y0 * (w + 1) + x0] - t[y0 * (w + 1) + x1] - t[y1 * (w + 1) + x0]) as f64;
            let mean = area(&sum) / n;
            let sd = (area(&sq) / n - mean * mean).max(0.0).sqrt();
            let threshold = mean * (1.0 + 0.2 * (sd / 128.0 - 1.0));
            let v = gray.get_pixel(x as u32, y as u32).0[0] as f64;
            ink[y * w + x] = v < threshold || v < solid;
        }
    }
    ink
}

/// Whether a color picture is really gray and can be stored as gray: hardly a
/// pixel has color. A small stamp, a blue signature or a logo keeps it in color.
fn looks_gray(rgb: &RgbImage) -> bool {
    let colored = rgb.pixels().filter(|p| p.0.iter().max().unwrap() - p.0.iter().min().unwrap() > 30).count();
    colored * 5000 < rgb.pixels().len()
}

/// What cleaning the picture gives: an image stream to draw, and the skew undone.
pub struct Cleaned {
    pub stream: Stream,
    pub angle: f64,
}

/// The gray version of whichever image is kept.
fn luminance(gray: &Option<GrayImage>, color: &Option<RgbImage>) -> GrayImage {
    match (gray, color) {
        (Some(g), _) => g.clone(),
        (None, Some(rgb)) => DynamicImage::ImageRgb8(rgb.clone()).to_luma8(),
        (None, None) => GrayImage::new(1, 1),
    }
}

pub fn clean(picture: DynamicImage, c: &Cleanup) -> Cleaned {
    let (w, h) = (picture.width(), picture.height());
    let rgb = picture.to_rgb8();
    let gray_only = c.black_white || looks_gray(&rgb);
    let mut gray = if gray_only { Some(DynamicImage::ImageRgb8(rgb.clone()).to_luma8()) } else { None };
    let mut color = if gray_only { None } else { Some(rgb) };

    let angle = if c.deskew { skew_angle(&luminance(&gray, &color)) } else { 0.0 };
    if angle != 0.0 {
        if let Some(g) = &gray {
            gray = GrayImage::from_raw(w, h, rotate::<1>(g.as_raw(), w, h, -angle));
        }
        if let Some(rgb) = &color {
            color = RgbImage::from_raw(w, h, rotate::<3>(rgb.as_raw(), w, h, -angle));
        }
    }
    if c.borders {
        let edges = edge_dark(&luminance(&gray, &color));
        let white = |x: u32, y: u32| edges[(y * w + x) as usize];
        if let Some(g) = gray.as_mut() {
            for (x, y, p) in g.enumerate_pixels_mut() {
                if white(x, y) {
                    p.0 = [255];
                }
            }
        }
        if let Some(rgb) = color.as_mut() {
            for (x, y, p) in rgb.enumerate_pixels_mut() {
                if white(x, y) {
                    p.0 = [255, 255, 255];
                }
            }
        }
    }

    let stream = if c.black_white {
        // One bit per pixel, 1 = white, rows padded to whole bytes.
        let ink = black_white(gray.as_ref().unwrap());
        let row = (w as usize).div_ceil(8);
        let mut bits = vec![0xFFu8; row * h as usize];
        for y in 0..h as usize {
            for x in 0..w as usize {
                if ink[y * w as usize + x] {
                    bits[y * row + x / 8] &= !(0x80 >> (x % 8));
                }
            }
        }
        let mut s = Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64, "ColorSpace" => "DeviceGray", "BitsPerComponent" => 1 },
            bits,
        );
        let _ = s.compress();
        s
    } else {
        let (img, cs) = match (gray, color) {
            (Some(g), _) => (DynamicImage::ImageLuma8(g), "DeviceGray"),
            (None, Some(rgb)) => (DynamicImage::ImageRgb8(rgb), "DeviceRGB"),
            (None, None) => unreachable!(),
        };
        let mut jpeg = Vec::new();
        let _ = JpegEncoder::new_with_quality(&mut jpeg, 85).encode_image(&img);
        let mut s = Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64, "ColorSpace" => cs, "BitsPerComponent" => 8, "Filter" => "DCTDecode" },
            jpeg,
        );
        s.allows_compression = false;
        s
    };
    Cleaned { stream, angle }
}

/// Replaces the content of the page in `dict` with its cleaned picture; returns the skew undone.
pub fn apply(doc: &mut Document, dict: &mut Dictionary, c: &Cleanup) -> AppResult<f64> {
    let picture = image::open(Path::new(&c.path)).map_err(|e| AppError::msg(format!("Couldn't read the page picture: {e}")))?;
    let view = visible_box(dict).ok_or_else(|| AppError::msg("The page has no size"))?;
    let cleaned = clean(picture, c);
    let id = doc.add_object(cleaned.stream);
    let [x0, y0, x1, y1] = view;
    let draw = format!("q {:.4} 0 0 {:.4} {x0:.4} {y0:.4} cm /{PICTURE} Do Q\n", x1 - x0, y1 - y0);
    dict.set("Contents", doc.add_object(Stream::new(Dictionary::new(), draw.into_bytes())));
    let mut xobjects = Dictionary::new();
    xobjects.set(PICTURE, id);
    let mut res = Dictionary::new();
    res.set("XObject", Object::Dictionary(xobjects));
    dict.set("Resources", res);
    for key in [&b"Thumb"[..], b"PieceInfo", b"Group"] {
        dict.remove(key);
    }
    Ok(cleaned.angle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    /// A page of "text": dark bars in rows, tilted by `deg`, with a black band down the left edge.
    fn page(deg: f64, band: u32) -> GrayImage {
        let (w, h) = (900u32, 1200u32);
        let mut img = GrayImage::from_pixel(w, h, Luma([245]));
        let (s, c) = deg.to_radians().sin_cos();
        for line in 0..30 {
            let base = 150.0 + line as f64 * 30.0;
            for x in 120..780 {
                // Words: gaps every so often.
                if (x / 40) % 5 == 4 {
                    continue;
                }
                for t in 0..8 {
                    let (dx, dy) = (x as f64 - 450.0, base + t as f64 - 600.0);
                    let (rx, ry) = (dx * c + dy * s + 450.0, -dx * s + dy * c + 600.0);
                    if rx >= 0.0 && ry >= 0.0 && (rx as u32) < w && (ry as u32) < h {
                        img.put_pixel(rx as u32, ry as u32, Luma([30]));
                    }
                }
            }
        }
        for x in 0..band {
            for y in 0..h {
                img.put_pixel(x, y, Luma([10]));
            }
        }
        img
    }

    #[test]
    fn measures_the_skew_of_lines() {
        for deg in [-3.0, 0.0, 2.0] {
            let found = skew_angle(&page(deg, 0));
            assert!((found - deg).abs() < 0.3, "tilted {deg}°, found {found}°");
        }
    }

    #[test]
    fn straightens_whitens_edges_and_makes_black_and_white() {
        let img = DynamicImage::ImageLuma8(page(2.0, 40));
        let c = Cleanup { path: String::new(), deskew: true, borders: true, black_white: true };
        let out = clean(img, &c);
        assert!((out.angle - 2.0).abs() < 0.3, "{}", out.angle);
        assert_eq!(out.stream.dict.get(b"BitsPerComponent").unwrap().as_i64().unwrap(), 1);
        let bits = out.stream.decompressed_content().unwrap();
        let row = 900usize.div_ceil(8);
        // The left band is gone: its pixels are white (bits set), half way down the page.
        assert_eq!(bits[600 * row], 0xFF);
        // And there is ink where the text is.
        assert!(bits.iter().any(|&b| b != 0xFF));
    }

    #[test]
    fn keeps_solid_dark_areas_solid_and_page_content_away_from_edges() {
        // A black square in the middle (a stamp) and a dark wedge reaching in from a corner.
        let mut img = GrayImage::from_pixel(800, 1000, Luma([240]));
        for x in 300..500 {
            for y in 400..600 {
                img.put_pixel(x, y, Luma([20]));
            }
        }
        for y in 0..1000u32 {
            for x in 0..(y / 25) {
                img.put_pixel(x, y, Luma([15]));
            }
        }
        let c = Cleanup { path: String::new(), deskew: false, borders: true, black_white: true };
        let bits = clean(DynamicImage::ImageLuma8(img), &c).stream.decompressed_content().unwrap();
        let row = 800usize.div_ceil(8);
        let ink = |x: usize, y: usize| bits[y * row + x / 8] & (0x80 >> (x % 8)) == 0;
        assert!(ink(400, 500), "the middle of the square stays black");
        assert!(!ink(10, 900) && !ink(30, 990), "the wedge is gone");
    }

    #[test]
    fn keeps_color_when_not_asked_for_black_and_white() {
        let mut rgb = RgbImage::from_pixel(300, 400, image::Rgb([250, 250, 250]));
        for x in 50..250 {
            for y in 100..200 {
                rgb.put_pixel(x, y, image::Rgb([200, 30, 30]));
            }
        }
        let c = Cleanup { path: String::new(), deskew: true, borders: true, black_white: false };
        let out = clean(DynamicImage::ImageRgb8(rgb.clone()), &c);
        assert_eq!(out.stream.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        // A small red stamp on a big white page is still color.
        let mut page = RgbImage::from_pixel(2000, 2800, image::Rgb([250, 250, 250]));
        for x in 900..1000 {
            for y in 1300..1360 {
                page.put_pixel(x, y, image::Rgb([220, 30, 30]));
            }
        }
        assert!(!looks_gray(&page));
        assert!(looks_gray(&RgbImage::from_pixel(100, 100, image::Rgb([128, 129, 127]))));
    }
}
