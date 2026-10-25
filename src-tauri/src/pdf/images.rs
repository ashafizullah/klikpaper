//! Images to PDF: one image per page. JPEGs are embedded as they are (no
//! quality loss); other formats are stored losslessly, with transparency kept
//! as a soft mask.
use crate::error::{AppError, AppResult};
use image::{DynamicImage, ImageDecoder, ImageFormat};
use lopdf::{Dictionary, Document, Object, Stream, dictionary};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;

/// Formats accepted as input.
pub const EXTENSIONS: [&str; 8] = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PageSize {
    /// The page takes the image's size (at 96 pixels per inch).
    Fit,
    A4,
    Letter,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Orientation {
    /// Portrait or landscape, whichever suits each image.
    Auto,
    Portrait,
    Landscape,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImagesJob {
    pub images: Vec<String>,
    pub output: String,
    pub page_size: PageSize,
    pub orientation: Orientation,
    /// Margin in points (1/72 inch).
    #[serde(default)]
    pub margin: f32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImagesResult {
    pub pages: usize,
    pub bytes: u64,
}

struct Embedded {
    width: u32,
    height: u32,
    stream: Stream,
    smask: Option<Stream>,
}

fn image_stream(width: u32, height: u32, color_space: &str, filter: Option<&str>, data: Vec<u8>) -> Stream {
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => width as i64,
        "Height" => height as i64,
        "ColorSpace" => color_space,
        "BitsPerComponent" => 8,
    };
    if let Some(f) = filter {
        dict.set("Filter", f);
    }
    let mut stream = Stream::new(dict, data);
    if filter.is_some() {
        stream.allows_compression = false;
    } else {
        let _ = stream.compress();
    }
    stream
}

fn embed(bytes: Vec<u8>) -> AppResult<Embedded> {
    let format = image::guess_format(&bytes)?;
    if format == ImageFormat::Jpeg {
        let decoder = image::codecs::jpeg::JpegDecoder::new(Cursor::new(&bytes))?;
        let (width, height) = decoder.dimensions();
        let color_space = match decoder.original_color_type() {
            image::ExtendedColorType::L8 => Some("DeviceGray"),
            image::ExtendedColorType::Rgb8 => Some("DeviceRGB"),
            // CMYK JPEGs differ between writers (Adobe's are inverted); decoding and re-encoding is the safe path.
            _ => None,
        };
        if let Some(cs) = color_space {
            return Ok(Embedded { width, height, stream: image_stream(width, height, cs, Some("DCTDecode"), bytes), smask: None });
        }
    }
    let img = image::load_from_memory(&bytes)?;
    let (width, height) = (img.width(), img.height());
    let alpha = img.color().has_alpha().then(|| img.to_luma_alpha8().pixels().map(|p| p.0[1]).collect::<Vec<u8>>());
    let smask = alpha.filter(|a| a.iter().any(|&v| v != 255)).map(|a| image_stream(width, height, "DeviceGray", None, a));
    let stream = match img {
        DynamicImage::ImageLuma8(_) | DynamicImage::ImageLuma16(_) | DynamicImage::ImageLumaA8(_) | DynamicImage::ImageLumaA16(_) => {
            image_stream(width, height, "DeviceGray", None, img.to_luma8().into_raw())
        }
        _ => image_stream(width, height, "DeviceRGB", None, img.to_rgb8().into_raw()),
    };
    Ok(Embedded { width, height, stream, smask })
}

/// Page size in points for an image of `w`×`h` points.
fn page_size(size: PageSize, orientation: Orientation, w: f32, h: f32, margin: f32) -> (f32, f32) {
    let (pw, ph) = match size {
        PageSize::Fit => return (w + 2.0 * margin, h + 2.0 * margin),
        PageSize::A4 => (595.28, 841.89),
        PageSize::Letter => (612.0, 792.0),
    };
    let landscape = match orientation {
        Orientation::Auto => w > h,
        Orientation::Portrait => false,
        Orientation::Landscape => true,
    };
    if landscape { (ph, pw) } else { (pw, ph) }
}

pub fn images_to_pdf(job: &ImagesJob) -> AppResult<ImagesResult> {
    let output = Path::new(&job.output);
    if !super::has_extension(output, &["pdf"]) {
        return Err(AppError::msg("The output file must end in .pdf"));
    }
    if job.images.is_empty() {
        return Err(AppError::msg("Choose at least one image"));
    }
    let margin = job.margin.clamp(0.0, 144.0);
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for path in &job.images {
        let path = Path::new(path);
        if !super::has_extension(path, &EXTENSIONS) {
            return Err(AppError::msg(format!("{} is not a supported image", path.display())));
        }
        let img = embed(std::fs::read(path)?).map_err(|e| AppError::msg(format!("{}: {e}", path.display())))?;
        let mut stream = img.stream;
        if let Some(mask) = img.smask {
            let mask_id = doc.add_object(mask);
            stream.dict.set("SMask", mask_id);
        }
        let img_id = doc.add_object(stream);

        // 96 pixels per inch, the usual screen density, gives a sensible natural size.
        let (w, h) = (img.width as f32 * 0.75, img.height as f32 * 0.75);
        let (pw, ph) = page_size(job.page_size, job.orientation, w, h, margin);
        let scale = ((pw - 2.0 * margin) / w).min((ph - 2.0 * margin) / h).min(if job.page_size == PageSize::Fit { 1.0 } else { f32::MAX });
        let (dw, dh) = (w * scale, h * scale);
        let (x, y) = ((pw - dw) / 2.0, (ph - dh) / 2.0);
        let content = format!("q {dw:.3} 0 0 {dh:.3} {x:.3} {y:.3} cm /Im0 Do Q");
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), Object::Real(pw), Object::Real(ph)],
            "Contents" => content_id,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img_id } },
        });
        kids.push(Object::Reference(page));
    }
    let count = kids.len();
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count as i64 }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let bytes = super::save(&mut doc, output, false)?;
    Ok(ImagesResult { pages: count, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::tests::temp_dir;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    #[test]
    fn makes_one_page_per_image() {
        let dir = temp_dir();
        let jpg = dir.join("photo.jpg");
        RgbImage::from_pixel(800, 600, Rgb([200, 30, 30])).save(&jpg).unwrap();
        let png = dir.join("logo.png");
        let mut logo = RgbaImage::from_pixel(300, 400, Rgba([0, 0, 255, 255]));
        logo.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        logo.save(&png).unwrap();
        let out = dir.join("images.pdf");
        let job = ImagesJob {
            images: vec![jpg.display().to_string(), png.display().to_string()],
            output: out.display().to_string(),
            page_size: PageSize::A4,
            orientation: Orientation::Auto,
            margin: 36.0,
        };
        assert_eq!(images_to_pdf(&job).unwrap().pages, 2);
        let doc = Document::load(&out).unwrap();
        let boxes: Vec<Vec<f32>> = doc
            .get_pages()
            .values()
            .map(|id| {
                doc.get_dictionary(*id)
                    .unwrap()
                    .get(b"MediaBox")
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|o| o.as_float().unwrap())
                    .collect()
            })
            .collect();
        // The wide photo gets a landscape page, the tall logo a portrait one.
        assert!(boxes[0][2] > boxes[0][3]);
        assert!(boxes[1][2] < boxes[1][3]);
        let streams: Vec<&Stream> = doc.objects.values().filter_map(|o| o.as_stream().ok()).collect();
        assert!(streams.iter().any(|s| s.dict.get(b"Filter").and_then(Object::as_name).is_ok_and(|f| f == b"DCTDecode")));
        assert!(streams.iter().any(|s| s.dict.has(b"SMask")));

        let bad = ImagesJob { images: vec![dir.join("notes.txt").display().to_string()], ..job };
        assert!(images_to_pdf(&bad).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
