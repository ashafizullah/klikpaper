#!/usr/bin/env python3
"""Writes the signed PDFs src-tauri/src/pdf/signatures.rs is tested with, signed
by OpenSSL (an implementation separate from KlikPaper's own checks):

  signed-rsa.pdf       RSA 2048, SHA-256, signed attributes (adbe.pkcs7.detached)
  signed-ec.pdf        ECDSA P-256, SHA-256
  signed-then-edited.pdf  signed-rsa.pdf with an incremental update appended
  tampered.pdf         signed-rsa.pdf with one byte of the signed content changed

Run from the repository root: python3 scripts/signed-fixtures.py
The keys and certificates are throwaway, self-signed and made on each run.
"""
import os, subprocess, tempfile

OUT = "src-tauri/tests/fixtures"
HEX = 16384  # characters reserved for the signature


def pdf_with_placeholder(name: str) -> bytes:
    content = b"BT /F1 18 Tf 72 720 Td (Surat Perjanjian - versi final) Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Annots [4 0 R]"
        b" /Resources << /Font << /F1 7 0 R >> >> >>",
        b"<< /Type /Annot /Subtype /Widget /FT /Sig /T (Tanda tangan 1) /V 5 0 R /Rect [0 0 0 0] /P 3 0 R /F 132 >>",
        b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (" + name.encode() + b")"
        b" /Reason (Persetujuan) /Location (Jakarta) /M (D:20261028090000+07'00')"
        b" /ByteRange [0000000000 0000000000 0000000000 0000000000] /Contents <" + b"0" * HEX + b"> >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def sign(pdf: bytes, key: str, cert: str, tmp: str) -> bytes:
    start = pdf.index(b"/Contents <") + len(b"/Contents ")
    end = pdf.index(b">", start) + 1
    ranges = [0, start, end, len(pdf) - end]
    # Same width as the placeholder, so no offset moves.
    placeholder = b"[0000000000 0000000000 0000000000 0000000000]"
    field = b"[" + b" ".join(f"{v:010d}".encode() for v in ranges) + b"]"
    pdf = pdf.replace(placeholder, field)
    data = pdf[:start] + pdf[end:]
    open(f"{tmp}/data", "wb").write(data)
    subprocess.run(["openssl", "cms", "-sign", "-binary", "-outform", "DER", "-md", "sha256", "-in", f"{tmp}/data",
                    "-signer", cert, "-inkey", key, "-out", f"{tmp}/sig.der"], check=True)
    sig = open(f"{tmp}/sig.der", "rb").read().hex().encode()
    assert len(sig) <= HEX
    return pdf[: start + 1] + sig.ljust(HEX, b"0") + pdf[end - 1:]


def cert(tmp: str, kind: str, cn: str):
    key, crt = f"{tmp}/{kind}.key", f"{tmp}/{kind}.crt"
    algo = ["-newkey", "rsa:2048"] if kind == "rsa" else ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256"]
    subprocess.run(["openssl", "req", "-x509", *algo, "-nodes", "-keyout", key, "-out", crt, "-days", "3650",
                    "-subj", f"/CN={cn}/O=Contoh Corp/C=ID"], check=True, capture_output=True)
    return key, crt


with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(OUT, exist_ok=True)
    rsa = sign(pdf_with_placeholder("Budi Santoso"), *cert(tmp, "rsa", "Budi Santoso"), tmp)
    open(f"{OUT}/signed-rsa.pdf", "wb").write(rsa)
    ec = sign(pdf_with_placeholder("Siti Aminah"), *cert(tmp, "ec", "Siti Aminah"), tmp)
    open(f"{OUT}/signed-ec.pdf", "wb").write(ec)

    # An incremental update after signing: the page says something else now.
    start_xref = int(rsa.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
    new = b"BT /F1 18 Tf 72 720 Td (Surat Perjanjian - DIUBAH) Tj ET"
    obj = b"6 0 obj\n<< /Length " + str(len(new)).encode() + b" >>\nstream\n" + new + b"\nendstream\nendobj\n"
    at = len(rsa)
    upd = obj + f"xref\n6 1\n{at:010d} 00000 n \ntrailer\n<< /Size 8 /Root 1 0 R /Prev {start_xref} >>\nstartxref\n{at + len(obj)}\n%%EOF\n".encode()
    open(f"{OUT}/signed-then-edited.pdf", "wb").write(rsa + upd)

    # One byte of the signed text changed in place: the signature no longer matches.
    open(f"{OUT}/tampered.pdf", "wb").write(rsa.replace(b"versi final", b"versi FINAL", 1))
print("written to", OUT)
