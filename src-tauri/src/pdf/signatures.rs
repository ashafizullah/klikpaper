//! Checking digital signatures (certificate-based, as made by Acrobat, BSrE
//! and other signing services). For each signature: whether the signed bytes
//! of the file are unchanged (their digest matches the one that was signed),
//! whether the signature checks out with the signer's certificate, whether
//! anything was added to the file after signing, and who signed, when and
//! with what certificate. Whether the certificate's issuer is trusted, or the
//! certificate was revoked, is not checked: that needs the issuer's lists.
//!
//! Signatures are read from the file's raw bytes (the signed ranges must be
//! hashed exactly as written), and the form fields only to name them.
use super::{comments::pdf_date_to_iso, load, text_string};
use crate::error::AppResult;
use cms::cert::CertificateChoices;
use cms::content_info::ContentInfo;
use cms::signed_data::{SignedData, SignerIdentifier, SignerInfo};
use const_oid::ObjectIdentifier;
use der::asn1::{OctetString, UintRef};
use der::{Decode, Encode, Sequence, SliceReader, Tag, Tagged};
use lopdf::{Dictionary, Document, Object, ObjectId};
use num_bigint::BigUint;
use serde::Serialize;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha384, Sha512};
use std::collections::HashMap;
use std::path::Path;
use x509_cert::Certificate;
use x509_cert::ext::pkix::SubjectKeyIdentifier;
use x509_cert::name::Name;
use x509_cert::spki::{AlgorithmIdentifierOwned, SubjectPublicKeyInfoOwned};
use x509_cert::time::Time;

const OID_MESSAGE_DIGEST: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.4");
const OID_SIGNING_TIME: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.5");
const OID_TST_INFO: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.1.4");
const OID_SKI: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.14");
const OID_CN: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.3");
const OID_O: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.10");
const OID_P256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7");
const OID_P384: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.132.0.34");

/// A certificate as people read it.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    /// Common name, or the whole name when it has none.
    pub name: String,
    pub organization: Option<String>,
    pub issuer: String,
    pub issuer_organization: Option<String>,
    /// ISO 8601, UTC.
    pub valid_from: String,
    pub valid_to: String,
    /// Issued by itself: anyone can make one in any name.
    pub self_signed: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureReport {
    /// The form field holding it.
    pub field: Option<String>,
    /// 0-based page of its field, when it has one on a page.
    pub page: Option<u32>,
    /// A document timestamp rather than a person's signature.
    pub timestamp: bool,
    pub sub_filter: Option<String>,
    /// What the signing software wrote in the signature: name, reason, place, contact.
    pub name: Option<String>,
    pub reason: Option<String>,
    pub location: Option<String>,
    pub contact: Option<String>,
    /// When it was signed (ISO 8601), from the signature itself or the PDF's own field.
    pub signed_at: Option<String>,
    pub signer: Option<CertInfo>,
    /// Who issued the certificates above the signer's, nearest first.
    pub chain: Vec<String>,
    /// "valid", "invalid", or "unknown" (couldn't be checked: see `problem`).
    pub status: String,
    /// The signed bytes are as they were when signed.
    pub intact: Option<bool>,
    /// The signature checks out with the signer's certificate.
    pub verified: Option<bool>,
    /// Nothing was added to the file after this signature.
    pub covers_all: bool,
    /// The certificate was within its validity dates when signing.
    pub cert_valid_when_signed: Option<bool>,
    pub problem: Option<String>,
}

// ---- digests and keys --------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
enum Hash {
    Sha1,
    Sha256,
    Sha384,
    Sha512,
}

impl Hash {
    fn from_oid(oid: &ObjectIdentifier) -> Option<Hash> {
        Some(match oid.to_string().as_str() {
            "1.3.14.3.2.26" => Hash::Sha1,
            "2.16.840.1.101.3.4.2.1" => Hash::Sha256,
            "2.16.840.1.101.3.4.2.2" => Hash::Sha384,
            "2.16.840.1.101.3.4.2.3" => Hash::Sha512,
            _ => return None,
        })
    }

    fn oid(self) -> &'static str {
        match self {
            Hash::Sha1 => "1.3.14.3.2.26",
            Hash::Sha256 => "2.16.840.1.101.3.4.2.1",
            Hash::Sha384 => "2.16.840.1.101.3.4.2.2",
            Hash::Sha512 => "2.16.840.1.101.3.4.2.3",
        }
    }

    fn digest(self, parts: &[&[u8]]) -> Vec<u8> {
        fn run<D: Digest>(parts: &[&[u8]]) -> Vec<u8> {
            let mut d = D::new();
            for p in parts {
                d.update(p);
            }
            d.finalize().to_vec()
        }
        match self {
            Hash::Sha1 => run::<Sha1>(parts),
            Hash::Sha256 => run::<Sha256>(parts),
            Hash::Sha384 => run::<Sha384>(parts),
            Hash::Sha512 => run::<Sha512>(parts),
        }
    }
}

enum Scheme {
    Rsa(Hash),
    Ecdsa(Hash),
}

/// The signature scheme of an algorithm identifier; `fallback` is the hash when the identifier names only the key type.
fn scheme(alg: &ObjectIdentifier, fallback: Option<Hash>) -> Result<Scheme, String> {
    let need = || fallback.ok_or_else(|| "an unknown digest algorithm".to_string());
    Ok(match alg.to_string().as_str() {
        "1.2.840.113549.1.1.1" => Scheme::Rsa(need()?),
        "1.2.840.113549.1.1.5" => Scheme::Rsa(Hash::Sha1),
        "1.2.840.113549.1.1.11" => Scheme::Rsa(Hash::Sha256),
        "1.2.840.113549.1.1.12" => Scheme::Rsa(Hash::Sha384),
        "1.2.840.113549.1.1.13" => Scheme::Rsa(Hash::Sha512),
        "1.2.840.10045.2.1" => Scheme::Ecdsa(need()?),
        "1.2.840.10045.4.1" => Scheme::Ecdsa(Hash::Sha1),
        "1.2.840.10045.4.3.2" => Scheme::Ecdsa(Hash::Sha256),
        "1.2.840.10045.4.3.3" => Scheme::Ecdsa(Hash::Sha384),
        "1.2.840.10045.4.3.4" => Scheme::Ecdsa(Hash::Sha512),
        "1.2.840.113549.1.1.10" => return Err("an RSA-PSS signature, which KlikPaper can't check yet".into()),
        other => return Err(format!("an unknown signature algorithm ({other})")),
    })
}

#[derive(Sequence)]
struct RsaPublicKey<'a> {
    modulus: UintRef<'a>,
    exponent: UintRef<'a>,
}

#[derive(Sequence)]
struct DigestInfo {
    algorithm: AlgorithmIdentifierOwned,
    digest: OctetString,
}

/// RSA PKCS #1 v1.5: the signature, raised to the public exponent, must be the padded DigestInfo of `hash`.
fn rsa_verify(key: &[u8], signature: &[u8], hash: Hash, digest: &[u8]) -> Result<bool, String> {
    let key = RsaPublicKey::from_der(key).map_err(|_| "an RSA key that couldn't be read")?;
    let n = BigUint::from_bytes_be(key.modulus.as_bytes());
    let e = BigUint::from_bytes_be(key.exponent.as_bytes());
    let s = BigUint::from_bytes_be(signature);
    if s >= n {
        return Ok(false);
    }
    let size = n.bits().div_ceil(8) as usize;
    let m = s.modpow(&e, &n).to_bytes_be();
    if m.len() > size {
        return Ok(false);
    }
    let mut em = vec![0u8; size - m.len()];
    em.extend(m);
    // 00 01 FF…FF 00 DigestInfo, with at least eight bytes of padding.
    if em.len() < 11 || em[0] != 0 || em[1] != 1 {
        return Ok(false);
    }
    let Some(zero) = em[2..].iter().position(|&b| b != 0xFF) else { return Ok(false) };
    if zero < 8 || em[2 + zero] != 0 {
        return Ok(false);
    }
    let Ok(info) = DigestInfo::from_der(&em[3 + zero..]) else { return Ok(false) };
    Ok(info.algorithm.oid.to_string() == hash.oid() && info.digest.as_bytes() == digest)
}

fn ecdsa_verify(spki: &SubjectPublicKeyInfoOwned, signature: &[u8], digest: &[u8]) -> Result<bool, String> {
    use p256::ecdsa::signature::hazmat::PrehashVerifier;
    let key = spki.subject_public_key.raw_bytes();
    let curve = spki.algorithm.parameters.as_ref().and_then(|p| p.decode_as::<ObjectIdentifier>().ok());
    match curve {
        Some(c) if c == OID_P256 => {
            let vk = p256::ecdsa::VerifyingKey::from_sec1_bytes(key).map_err(|_| "an ECDSA key that couldn't be read")?;
            let Ok(sig) = p256::ecdsa::Signature::from_der(signature) else { return Ok(false) };
            Ok(vk.verify_prehash(digest, &sig).is_ok())
        }
        Some(c) if c == OID_P384 => {
            let vk = p384::ecdsa::VerifyingKey::from_sec1_bytes(key).map_err(|_| "an ECDSA key that couldn't be read")?;
            let Ok(sig) = p384::ecdsa::Signature::from_der(signature) else { return Ok(false) };
            Ok(vk.verify_prehash(digest, &sig).is_ok())
        }
        _ => Err("an elliptic curve KlikPaper can't check yet".into()),
    }
}

/// Whether `signature` over `message` was made with the key in `spki`.
fn verify(
    spki: &SubjectPublicKeyInfoOwned,
    alg: &ObjectIdentifier,
    fallback: Option<Hash>,
    message: &[u8],
    signature: &[u8],
) -> Result<bool, String> {
    match scheme(alg, fallback)? {
        Scheme::Rsa(h) => rsa_verify(spki.subject_public_key.raw_bytes(), signature, h, &h.digest(&[message])),
        Scheme::Ecdsa(h) => ecdsa_verify(spki, signature, &h.digest(&[message])),
    }
}

// ---- certificates --------------------------------------------------------------------

fn name_part(name: &Name, oid: ObjectIdentifier) -> Option<String> {
    for rdn in name.0.iter() {
        for atv in rdn.0.iter() {
            if atv.oid != oid {
                continue;
            }
            let bytes = atv.value.value();
            let text = match atv.value.tag() {
                Tag::BmpString => {
                    String::from_utf16_lossy(&bytes.as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect::<Vec<_>>())
                }
                Tag::TeletexString => bytes.iter().map(|&b| b as char).collect(),
                _ => String::from_utf8_lossy(bytes).into_owned(),
            };
            return Some(text.trim().to_string()).filter(|s| !s.is_empty());
        }
    }
    None
}

fn display_name(name: &Name) -> String {
    name_part(name, OID_CN).unwrap_or_else(|| name.to_string())
}

fn iso(time: Time) -> String {
    super::iso_datetime(time.to_unix_duration().as_secs())
}

fn cert_info(c: &Certificate) -> CertInfo {
    let t = &c.tbs_certificate;
    CertInfo {
        name: display_name(&t.subject),
        organization: name_part(&t.subject, OID_O),
        issuer: display_name(&t.issuer),
        issuer_organization: name_part(&t.issuer, OID_O),
        valid_from: iso(t.validity.not_before),
        valid_to: iso(t.validity.not_after),
        self_signed: t.subject == t.issuer,
    }
}

fn subject_key_id(c: &Certificate) -> Option<Vec<u8>> {
    let ext = c.tbs_certificate.extensions.as_ref()?.iter().find(|e| e.extn_id == OID_SKI)?;
    Some(SubjectKeyIdentifier::from_der(ext.extn_value.as_bytes()).ok()?.0.as_bytes().to_vec())
}

fn signer_cert<'a>(certs: &'a [Certificate], sid: &SignerIdentifier) -> Option<&'a Certificate> {
    certs.iter().find(|c| match sid {
        SignerIdentifier::IssuerAndSerialNumber(id) => {
            c.tbs_certificate.issuer == id.issuer && c.tbs_certificate.serial_number == id.serial_number
        }
        SignerIdentifier::SubjectKeyIdentifier(ski) => subject_key_id(c).as_deref() == Some(ski.0.as_bytes()),
    })
}

/// The issuers above `cert` among the certificates in the signature, nearest first.
fn chain(certs: &[Certificate], cert: &Certificate) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = cert;
    for _ in 0..10 {
        let t = &at.tbs_certificate;
        if t.subject == t.issuer {
            break;
        }
        out.push(display_name(&t.issuer));
        match certs.iter().find(|c| c.tbs_certificate.subject == t.issuer) {
            Some(next) => at = next,
            None => break,
        }
    }
    out
}

// ---- one signature ---------------------------------------------------------------------

/// What the signed bytes' digest must equal, and the signature's own digest check.
struct Checked {
    intact: bool,
    verified: bool,
    signed_at: Option<String>,
    signer: Option<CertInfo>,
    chain: Vec<String>,
    cert_valid_when_signed: Option<bool>,
}

fn check(cms: &[u8], signed: &[&[u8]]) -> Result<Checked, String> {
    let info = ContentInfo::decode(&mut SliceReader::new(cms).map_err(|_| "a signature that couldn't be read")?)
        .map_err(|_| "a signature that couldn't be read")?;
    let data = info.content.decode_as::<SignedData>().map_err(|_| "a signature that couldn't be read")?;
    let certs: Vec<Certificate> = data
        .certificates
        .as_ref()
        .map(|set| set.0.iter().filter_map(|c| if let CertificateChoices::Certificate(c) = c { Some(c.clone()) } else { None }).collect())
        .unwrap_or_default();
    let si: &SignerInfo = data.signer_infos.0.iter().next().ok_or("a signature without a signer")?;
    let hash = Hash::from_oid(&si.digest_alg.oid).ok_or("an unknown digest algorithm")?;
    let cert = signer_cert(&certs, &si.sid).ok_or("a signature without the signer's certificate")?;

    // What was signed: the file's bytes, or (encapsulated) a digest or timestamp of them.
    let econtent = data.encap_content_info.econtent.as_ref().map(|a| a.value().to_vec());
    let mut intact = match &econtent {
        None => true,
        Some(content) if data.encap_content_info.econtent_type == OID_TST_INFO => {
            let (alg, imprint) = tst_imprint(content).ok_or("a timestamp that couldn't be read")?;
            imprint == alg.digest(signed)
        }
        // adbe.pkcs7.sha1: the content is the digest of the signed bytes.
        Some(content) => {
            let inner = OctetString::from_der(content).map(|o| o.as_bytes().to_vec()).unwrap_or_else(|_| content.clone());
            inner == Hash::Sha1.digest(signed) || inner == hash.digest(signed)
        }
    };
    let content_digest = match &econtent {
        Some(content) => hash.digest(&[content]),
        None => hash.digest(signed),
    };

    let mut signed_at = None;
    let (message, digest_ok) = match &si.signed_attrs {
        Some(attrs) => {
            let mut digest_ok = false;
            for a in attrs.iter() {
                if a.oid == OID_MESSAGE_DIGEST {
                    digest_ok = a
                        .values
                        .iter()
                        .next()
                        .and_then(|v| v.decode_as::<OctetString>().ok())
                        .is_some_and(|d| d.as_bytes() == content_digest);
                } else if a.oid == OID_SIGNING_TIME {
                    signed_at = a.values.iter().next().and_then(|v| Time::from_der(&v.to_der().ok()?).ok()).map(iso);
                }
            }
            (attrs.to_der().map_err(|_| "a signature that couldn't be read")?, digest_ok)
        }
        None => (Vec::new(), true),
    };
    intact &= digest_ok;

    let spki = &cert.tbs_certificate.subject_public_key_info;
    let sig = si.signature.as_bytes();
    let verified = if si.signed_attrs.is_some() {
        verify(spki, &si.signature_algorithm.oid, Some(hash), &message, sig)?
    } else {
        // Without signed attributes the signature is over the content itself.
        match scheme(&si.signature_algorithm.oid, Some(hash))? {
            Scheme::Rsa(h) => rsa_verify(spki.subject_public_key.raw_bytes(), sig, h, &content_digest_for(h, &econtent, signed))?,
            Scheme::Ecdsa(h) => ecdsa_verify(spki, sig, &content_digest_for(h, &econtent, signed))?,
        }
    };
    let when = signed_at.as_deref().and_then(iso_to_secs);
    let validity = &cert.tbs_certificate.validity;
    let cert_valid_when_signed =
        when.map(|t| t >= validity.not_before.to_unix_duration().as_secs() && t <= validity.not_after.to_unix_duration().as_secs());
    Ok(Checked { intact, verified, signed_at, signer: Some(cert_info(cert)), chain: chain(&certs, cert), cert_valid_when_signed })
}

fn content_digest_for(h: Hash, econtent: &Option<Vec<u8>>, signed: &[&[u8]]) -> Vec<u8> {
    match econtent {
        Some(c) => h.digest(&[c]),
        None => h.digest(signed),
    }
}

/// The message imprint of an RFC 3161 timestamp: its hash algorithm and the hash.
fn tst_imprint(tst: &[u8]) -> Option<(Hash, Vec<u8>)> {
    #[derive(Sequence)]
    struct MessageImprint {
        algorithm: AlgorithmIdentifierOwned,
        hashed: OctetString,
    }
    let mut r = SliceReader::new(tst).ok()?;
    use der::Reader;
    let header = der::Header::decode(&mut r).ok()?;
    let body = r.read_slice(header.length).ok()?;
    let mut r = SliceReader::new(body).ok()?;
    let _version = der::asn1::Int::decode(&mut r).ok()?;
    let _policy = ObjectIdentifier::decode(&mut r).ok()?;
    let imprint = MessageImprint::decode(&mut r).ok()?;
    Some((Hash::from_oid(&imprint.algorithm.oid)?, imprint.hashed.as_bytes().to_vec()))
}

/// Seconds since 1970 from "YYYY-MM-DDTHH:MM:SS…" (UTC or with an offset).
fn iso_to_secs(s: &str) -> Option<u64> {
    let d: Vec<i64> =
        s.get(..19)?.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).map(|p| p.parse().ok()).collect::<Option<_>>()?;
    let [y, mo, day, h, mi, se] = d[..] else { return None };
    let (y, m) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let mut secs = days * 86_400 + h * 3600 + mi * 60 + se;
    // An offset like +07:00 means the clock was ahead of UTC.
    if let Some(rest) = s.get(19..)
        && let Some(sign) = rest.find(['+', '-'])
    {
        let off: Vec<i64> = rest[sign + 1..].split(':').filter_map(|p| p.get(..2)?.parse().ok()).collect();
        let minutes = off.first().copied().unwrap_or(0) * 60 + off.get(1).copied().unwrap_or(0);
        secs -= if rest.as_bytes()[sign] == b'+' { minutes * 60 } else { -minutes * 60 };
    }
    u64::try_from(secs).ok()
}

// ---- the file --------------------------------------------------------------------------

/// Signature fields: the signature dictionary's id, the field's full name and its page.
fn fields(doc: &Document) -> Vec<(ObjectId, Option<String>, Option<u32>)> {
    let pages: HashMap<ObjectId, u32> = doc.get_pages().into_iter().map(|(n, id)| (id, n - 1)).collect();
    // Which page lists each annotation.
    let mut on_page: HashMap<ObjectId, u32> = HashMap::new();
    for (&page, &n) in &pages {
        let Ok(dict) = doc.get_dictionary(page) else { continue };
        let annots = match dict.get(b"Annots") {
            Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_array).cloned().unwrap_or_default(),
            Ok(Object::Array(a)) => a.clone(),
            _ => Vec::new(),
        };
        for a in annots {
            if let Ok(id) = a.as_reference() {
                on_page.insert(id, n);
            }
        }
    }
    let mut out = Vec::new();
    let Ok(catalog) = doc.catalog() else { return out };
    let Some(form) = catalog.get(b"AcroForm").ok().and_then(|o| doc.dereference(o).ok()).and_then(|(_, o)| o.as_dict().ok()) else {
        return out;
    };
    let roots =
        form.get(b"Fields").ok().and_then(|o| doc.dereference(o).ok()).and_then(|(_, o)| o.as_array().ok()).cloned().unwrap_or_default();
    #[allow(clippy::too_many_arguments)]
    fn walk(
        doc: &Document,
        item: &Object,
        parent: Option<&str>,
        ft: Option<Vec<u8>>,
        depth: usize,
        on_page: &HashMap<ObjectId, u32>,
        pages: &HashMap<ObjectId, u32>,
        out: &mut Vec<(ObjectId, Option<String>, Option<u32>)>,
    ) {
        if depth > 32 {
            return;
        }
        let Ok(id) = item.as_reference() else { return };
        let Ok(dict): Result<&Dictionary, _> = doc.get_dictionary(id) else { return };
        let own = dict.get(b"T").ok().and_then(|t| text_string(doc, t));
        let name = match (parent, own) {
            (Some(p), Some(o)) => Some(format!("{p}.{o}")),
            (None, Some(o)) => Some(o),
            (Some(p), None) => Some(p.to_string()),
            (None, None) => None,
        };
        let ft = dict.get(b"FT").ok().and_then(|o| o.as_name().ok()).map(<[u8]>::to_vec).or(ft);
        let page = on_page
            .get(&id)
            .copied()
            .or_else(|| dict.get(b"P").ok().and_then(|p| p.as_reference().ok()).and_then(|p| pages.get(&p).copied()));
        if ft.as_deref() == Some(b"Sig")
            && let Ok(v) = dict.get(b"V")
            && let Ok(sig) = v.as_reference()
        {
            let kid_page = dict
                .get(b"Kids")
                .ok()
                .and_then(|k| k.as_array().ok())
                .and_then(|k| k.iter().filter_map(|o| o.as_reference().ok()).find_map(|k| on_page.get(&k).copied()));
            out.push((sig, name.clone(), page.or(kid_page)));
        }
        if let Ok(kids) = dict.get(b"Kids").and_then(Object::as_array) {
            for k in kids {
                walk(doc, k, name.as_deref(), ft.clone(), depth + 1, on_page, pages, out);
            }
        }
    }
    for f in &roots {
        walk(doc, f, None, None, 0, &on_page, &pages, &mut out);
    }
    out
}

/// The length of the DER value at the start of `bytes`, header included.
fn der_length(bytes: &[u8]) -> Option<usize> {
    let mut r = SliceReader::new(bytes).ok()?;
    let header = der::Header::decode(&mut r).ok()?;
    let head = usize::try_from(header.encoded_len().ok()?).ok()?;
    Some(head + usize::try_from(header.length).ok()?)
}

fn number(o: &Object) -> Option<usize> {
    match o {
        Object::Integer(i) => usize::try_from(*i).ok(),
        Object::Real(r) if *r >= 0.0 => Some(*r as usize),
        _ => None,
    }
}

/// Every signature in the file, in the order of its fields.
pub fn read(path: &Path, password: Option<&str>) -> AppResult<Vec<SignatureReport>> {
    let raw = std::fs::read(path)?;
    let doc = load(path, password)?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (id, field, page) in fields(&doc) {
        let Ok(sig) = doc.get_dictionary(id) else { continue };
        let range: Vec<usize> =
            sig.get(b"ByteRange").and_then(Object::as_array).map(|a| a.iter().filter_map(number).collect()).unwrap_or_default();
        if !seen.insert(range.clone()) {
            continue;
        }
        let text = |key: &[u8]| sig.get(key).ok().and_then(|o| text_string(&doc, o));
        let sub_filter = sig.get(b"SubFilter").ok().and_then(|o| o.as_name().ok()).map(|n| String::from_utf8_lossy(n).into_owned());
        let mut report = SignatureReport {
            field,
            page,
            timestamp: sig.get(b"Type").ok().and_then(|o| o.as_name().ok()) == Some(b"DocTimeStamp")
                || sub_filter.as_deref() == Some("ETSI.RFC3161"),
            sub_filter,
            name: text(b"Name"),
            reason: text(b"Reason"),
            location: text(b"Location"),
            contact: text(b"ContactInfo"),
            signed_at: text(b"M").map(|m| pdf_date_to_iso(&m)).filter(|s| !s.is_empty()),
            signer: None,
            chain: Vec::new(),
            status: "unknown".into(),
            intact: None,
            verified: None,
            covers_all: false,
            cert_valid_when_signed: None,
            problem: None,
        };
        // The signed bytes are the two ranges around the signature's own hex string.
        let [a, b, c, d] = range[..] else {
            report.problem = Some("a signature without a valid byte range".into());
            out.push(report);
            continue;
        };
        let ok_range =
            a == 0 && b > 0 && c >= b + 2 && c.checked_add(d).is_some_and(|end| end <= raw.len()) && raw[b] == b'<' && raw[c - 1] == b'>';
        if !ok_range {
            report.status = "invalid".into();
            report.problem = Some("a byte range that doesn't fit the file".into());
            out.push(report);
            continue;
        }
        report.covers_all = raw[c + d..].iter().all(|b| b.is_ascii_whitespace());
        // The signature's place holds hex digits only (white space allowed), and after the
        // signature itself only zero padding: anything else was put there afterwards.
        let gap = &raw[b + 1..c - 1];
        if gap.iter().any(|b| !b.is_ascii_hexdigit() && !b.is_ascii_whitespace()) {
            report.status = "invalid".into();
            report.problem = Some("unexpected data in the signature's place".into());
            out.push(report);
            continue;
        }
        let hex: Vec<u8> = gap.iter().copied().filter(u8::is_ascii_hexdigit).collect();
        let bytes: Vec<u8> = hex.chunks(2).filter_map(|p| u8::from_str_radix(std::str::from_utf8(p).ok()?, 16).ok()).collect();
        let used = der_length(&bytes).unwrap_or(bytes.len());
        if bytes[used.min(bytes.len())..].iter().any(|&b| b != 0) {
            report.status = "invalid".into();
            report.problem = Some("unexpected data after the signature".into());
            out.push(report);
            continue;
        }
        match check(&bytes, &[&raw[..b], &raw[c..c + d]]) {
            Ok(r) => {
                report.status = if r.intact && r.verified { "valid" } else { "invalid" }.into();
                report.intact = Some(r.intact);
                report.verified = Some(r.verified);
                report.signed_at = r.signed_at.or(report.signed_at);
                report.signer = r.signer;
                report.chain = r.chain;
                report.cert_valid_when_signed = r.cert_valid_when_signed;
            }
            Err(why) => report.problem = Some(why),
        }
        out.push(report);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    fn only(name: &str) -> SignatureReport {
        let mut all = read(&fixture(name), None).unwrap();
        assert_eq!(all.len(), 1, "{all:?}");
        all.remove(0)
    }

    #[test]
    fn accepts_an_rsa_signature_over_the_whole_file() {
        let r = only("signed-rsa.pdf");
        assert_eq!((r.status.as_str(), r.intact, r.verified, r.covers_all), ("valid", Some(true), Some(true), true), "{r:?}");
        let signer = r.signer.unwrap();
        assert_eq!((signer.name.as_str(), signer.organization.as_deref(), signer.self_signed), ("Budi Santoso", Some("Contoh Corp"), true));
        assert_eq!(
            (r.field.as_deref(), r.page, r.reason.as_deref(), r.location.as_deref()),
            (Some("Tanda tangan 1"), Some(0), Some("Persetujuan"), Some("Jakarta"))
        );
        assert!(r.signed_at.is_some());
        assert_eq!(r.cert_valid_when_signed, Some(true));
    }

    #[test]
    fn accepts_an_ecdsa_signature() {
        let r = only("signed-ec.pdf");
        assert_eq!((r.status.as_str(), r.verified), ("valid", Some(true)), "{r:?}");
        assert_eq!(r.signer.unwrap().name, "Siti Aminah");
    }

    #[test]
    fn notices_changes_added_after_signing() {
        let r = only("signed-then-edited.pdf");
        // What was signed is untouched, but more was written after it.
        assert_eq!((r.status.as_str(), r.covers_all), ("valid", false), "{r:?}");
    }

    #[test]
    fn rejects_a_changed_byte() {
        let r = only("tampered.pdf");
        assert_eq!((r.status.as_str(), r.intact), ("invalid", Some(false)), "{r:?}");
    }

    #[test]
    fn rejects_a_forged_signature_value() {
        // The last byte of the RSA signature (just before the zero padding) changed: the content is intact,
        // but the signature no longer checks out with the certificate.
        let mut raw = std::fs::read(fixture("signed-rsa.pdf")).unwrap();
        let start = raw.windows(11).position(|w| w == b"/Contents <").unwrap() + 11;
        let end = start + raw[start..].iter().position(|&b| b == b'>').unwrap();
        let last = start + raw[start..end].iter().rposition(|&b| b != b'0').unwrap();
        raw[last] = if raw[last] == b'1' { b'2' } else { b'1' };
        let dir = crate::pdf::tests::temp_dir();
        let path = dir.join("forged.pdf");
        std::fs::write(&path, raw).unwrap();
        let r = read(&path, None).unwrap().remove(0);
        assert_eq!((r.status.as_str(), r.intact, r.verified), ("invalid", Some(true), Some(false)), "{r:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_data_hidden_in_the_padding() {
        // The zero padding after the signature replaced with other hex digits.
        let mut raw = std::fs::read(fixture("signed-rsa.pdf")).unwrap();
        let start = raw.windows(11).position(|w| w == b"/Contents <").unwrap() + 11;
        let end = start + raw[start..].iter().position(|&b| b == b'>').unwrap();
        raw[end - 8..end].copy_from_slice(b"deadbeef");
        let dir = crate::pdf::tests::temp_dir();
        let path = dir.join("padded.pdf");
        std::fs::write(&path, raw).unwrap();
        let r = read(&path, None).unwrap().remove(0);
        assert_eq!(r.status, "invalid", "{r:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_without_signatures_has_none() {
        let dir = crate::pdf::tests::temp_dir();
        let a = crate::pdf::tests::write_sample(&dir, "a.pdf", &["A1"]);
        assert!(read(Path::new(&a), None).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reads_dates_with_offsets() {
        assert_eq!(iso_to_secs("1970-01-01T00:00:10Z"), Some(10));
        assert_eq!(iso_to_secs("1970-01-01T07:00:00+07:00"), Some(0));
    }
}
