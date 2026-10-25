//! Lossy size reduction: photos are downscaled and re-encoded as JPEG. Text,
//! vector graphics and fonts are untouched; the caller also Flate-compresses
//! streams and packs objects into object streams.
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GrayImage, RgbImage, imageops::FilterType};
use lopdf::{Document, Object, ObjectId, Stream};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// Best quality: only JPEG photos are re-encoded, at high quality.
    Low,
    Medium,
    /// Smallest file.
    High,
}

impl Level {
    /// Longest side in pixels; about 300, 200 and 140 DPI on a full A4 page.
    fn max_side(self) -> u32 {
        match self {
            Level::Low => 3500,
            Level::Medium => 2300,
            Level::High => 1600,
        }
    }

    fn quality(self) -> u8 {
        match self {
            Level::Low => 85,
            Level::Medium => 72,
            Level::High => 55,
        }
    }

    /// Losslessly stored images (screenshots, diagrams) only become JPEG at the stronger levels.
    fn converts_lossless(self) -> bool {
        self != Level::Low
    }
}

/// Re-encodes the document's images; returns how many were replaced.
pub fn run(doc: &mut Document, level: Level) -> usize {
    // Soft masks and stencil masks hold transparency; lossy artefacts there show as halos.
    let masks: HashSet<ObjectId> = doc
        .objects
        .values()
        .filter_map(|o| o.as_stream().ok())
        .filter_map(|s| s.dict.get(b"SMask").and_then(Object::as_reference).ok())
        .collect();
    let candidates: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter(|(id, o)| {
            !masks.contains(id)
                && o.as_stream().is_ok_and(|s| s.dict.get(b"Subtype").and_then(Object::as_name).is_ok_and(|n| n == b"Image"))
        })
        .map(|(id, _)| *id)
        .collect();

    let mut replaced = 0;
    for id in candidates {
        let Some(Object::Stream(stream)) = doc.objects.get(&id) else { continue };
        let Some(new) = recompress(doc, stream, level) else { continue };
        doc.objects.insert(id, Object::Stream(new));
        replaced += 1;
    }
    if level != Level::Low {
        // Embedded page thumbnails are redundant: every viewer renders its own.
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        for page in pages {
            if let Ok(dict) = doc.get_dictionary_mut(page) {
                dict.remove(b"Thumb");
            }
        }
        doc.prune_objects();
    }
    replaced
}

/// Channels of a color space this module can safely rewrite (gray or RGB).
fn channels(doc: &Document, stream: &Stream) -> Option<u8> {
    let cs = stream.dict.get(b"ColorSpace").ok()?;
    let (_, cs) = doc.dereference(cs).ok()?;
    match cs {
        Object::Name(n) if n == b"DeviceRGB" => Some(3),
        Object::Name(n) if n == b"DeviceGray" => Some(1),
        // [/ICCBased stream]: the profile's /N gives the channel count.
        Object::Array(a) if a.first().and_then(|o| o.as_name().ok()) == Some(b"ICCBased") => {
            let (_, profile) = doc.dereference(a.get(1)?).ok()?;
            match profile.as_stream().ok()?.dict.get(b"N").and_then(Object::as_i64).ok()? {
                3 => Some(3),
                1 => Some(1),
                _ => None,
            }
        }
        _ => None,
    }
}

fn filters(stream: &Stream) -> Vec<Vec<u8>> {
    match stream.dict.get(b"Filter") {
        Ok(Object::Name(n)) => vec![n.clone()],
        Ok(Object::Array(a)) => a.iter().filter_map(|o| o.as_name().ok().map(<[u8]>::to_vec)).collect(),
        _ => Vec::new(),
    }
}

fn recompress(doc: &Document, stream: &Stream, level: Level) -> Option<Stream> {
    let dict = &stream.dict;
    if dict.get(b"ImageMask").and_then(Object::as_bool).unwrap_or(false) || dict.has(b"Decode") || dict.has(b"Mask") {
        return None;
    }
    let width = u32::try_from(dict.get(b"Width").and_then(Object::as_i64).ok()?).ok()?;
    let height = u32::try_from(dict.get(b"Height").and_then(Object::as_i64).ok()?).ok()?;
    if width < 64 || height < 64 {
        return None;
    }
    let channels = channels(doc, stream)?;
    let image = match filters(stream).iter().map(Vec::as_slice).collect::<Vec<_>>().as_slice() {
        [b"DCTDecode"] => {
            let img = image::load_from_memory_with_format(&stream.content, image::ImageFormat::Jpeg).ok()?;
            if img.width() != width || img.height() != height {
                return None;
            }
            img
        }
        [b"FlateDecode"] | [] if level.converts_lossless() => {
            if dict.get(b"BitsPerComponent").and_then(Object::as_i64).ok()? != 8 {
                return None;
            }
            // Never inflate more than the image can hold, so a crafted stream can't exhaust memory.
            let expected = usize::try_from(u64::from(width) * u64::from(height) * u64::from(channels)).ok()?;
            let raw = stream.decompressed_content_with_limit(expected).ok()?;
            match channels {
                3 => DynamicImage::ImageRgb8(RgbImage::from_raw(width, height, raw)?),
                _ => DynamicImage::ImageLuma8(GrayImage::from_raw(width, height, raw)?),
            }
        }
        _ => return None,
    };

    let max = level.max_side();
    let image = if width.max(height) > max { image.resize(max, max, FilterType::Triangle) } else { image };
    let image = if channels == 1 { DynamicImage::ImageLuma8(image.to_luma8()) } else { DynamicImage::ImageRgb8(image.to_rgb8()) };
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, level.quality()).encode_image(&image).ok()?;
    // Only worth it when clearly smaller than what is stored now.
    if jpeg.len() as f64 > stream.content.len() as f64 * 0.9 {
        return None;
    }

    let mut new_dict = dict.clone();
    new_dict.set("Width", image.width() as i64);
    new_dict.set("Height", image.height() as i64);
    new_dict.set("BitsPerComponent", 8);
    new_dict.set("Filter", "DCTDecode");
    new_dict.remove(b"DecodeParms");
    new_dict.remove(b"Length");
    let mut new = Stream::new(new_dict, jpeg);
    new.allows_compression = false;
    Some(new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::tests::temp_dir;
    use crate::pdf::{AssembleJob, Options, PageRef, Source, assemble};
    use lopdf::dictionary;

    /// A one-page PDF showing a noisy 1200×900 RGB photo stored losslessly.
    fn photo_pdf(path: &std::path::Path) {
        let (w, h) = (1200u32, 900u32);
        let mut seed = 7u32;
        let pixels: Vec<u8> = (0..w * h * 3)
            .map(|i| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                ((i / 3 % w) as u8).wrapping_add((seed >> 24) as u8 / 8)
            })
            .collect();
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut img = Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64, "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8 },
            pixels,
        );
        img.compress().unwrap();
        let img_id = doc.add_object(img);
        let content = doc.add_object(Stream::new(dictionary! {}, b"q 540 0 0 405 36 300 cm /Im0 Do Q".to_vec()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img_id } },
        });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        doc.save(path).unwrap();
    }

    #[test]
    fn shrinks_photos_and_keeps_the_page() {
        let dir = temp_dir();
        let input = dir.join("photo.pdf");
        photo_pdf(&input);
        let before = std::fs::metadata(&input).unwrap().len();
        let out = dir.join("small.pdf");
        let job = AssembleJob {
            sources: vec![Source { id: "p".into(), path: input.display().to_string(), password: None }],
            pages: vec![PageRef { source: "p".into(), index: 0, rotate: 0 }],
            output: out.display().to_string(),
            options: Options { compress: Some(Level::High), ..Default::default() },
        };
        let res = assemble(&job).unwrap();
        assert_eq!(res.images, 1);
        assert!(res.bytes < before / 2, "{} -> {}", before, res.bytes);
        let doc = Document::load(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        let img = doc.objects.values().filter_map(|o| o.as_stream().ok()).find(|s| s.dict.has(b"Width")).unwrap();
        assert_eq!(img.dict.get(b"Filter").unwrap().as_name().unwrap(), b"DCTDecode");
        assert!(image::load_from_memory(&img.content).is_ok());

        // The gentlest level leaves lossless images alone.
        let job = AssembleJob { options: Options { compress: Some(Level::Low), ..Default::default() }, ..job };
        assert_eq!(assemble(&job).unwrap().images, 0);
        let _ = std::fs::remove_dir_all(dir);
    }
}
