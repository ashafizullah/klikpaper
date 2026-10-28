import { describe, expect, test } from "bun:test";
import { findPii, isNik, luhn } from "./pii";

const values = (text: string) => findPii(text).map((m) => `${m.kind}:${m.value}`);

describe("personal data", () => {
  test("NIK is checked, not only counted", () => {
    expect(isNik("3201234507900001")).toBe(true);
    // A woman's NIK: day + 40.
    expect(isNik("3201235207900001")).toBe(true);
    // Province 05 doesn't exist; month 13 doesn't either.
    expect(isNik("0501234507900001")).toBe(false);
    expect(isNik("3201234513900001")).toBe(false);
    expect(values("NIK : 3201 2345 0790 0001 Nama: Budi")).toEqual(["nik:3201 2345 0790 0001"]);
    // Sixteen digits that can't be a NIK aren't one.
    expect(values("Ref 9999999999999999")).toEqual([]);
  });

  test("NPWP, formatted or after the word", () => {
    expect(values("NPWP 01.234.567.8-901.000 a.n. PT Maju")).toEqual(["npwp:01.234.567.8-901.000"]);
    expect(values("NPWP: 012345678901000")).toEqual(["npwp:012345678901000"]);
  });

  test("mobile numbers and email addresses", () => {
    expect(values("HP 0812-3456-7890, WA +62 812 3456 7891, budi.s@mail.co.id")).toEqual([
      "phone:0812-3456-7890",
      "phone:+62 812 3456 7891",
      "email:budi.s@mail.co.id",
    ]);
    // An invoice number starting with 08 but too short is left alone.
    expect(values("Invoice 0812345")).toEqual([]);
  });

  test("accounts only next to a word that says so; cards by shape and check digit", () => {
    expect(values("Rekening BCA 1234567890 atas nama Budi")).toEqual(["account:1234567890"]);
    expect(values("No. Rek: 123-456-7890")).toEqual(["account:123-456-7890"]);
    expect(values("Total 1234567890")).toEqual([]);
    expect(luhn("4111111111111111")).toBe(true);
    expect(values("Bayar dengan 4111 1111 1111 1111")).toEqual(["account:4111 1111 1111 1111"]);
    // Card-shaped but failing the check digit (and not a NIK either: month 13).
    expect(values("Kode 4111 1111 1311 1112")).toEqual([]);
  });

  test("birth dates only after a birth-date label", () => {
    expect(values("Tempat/Tgl Lahir : Bandung, 17-08-1990\nTanggal: 01-01-2026")).toEqual(["birthdate:17-08-1990"]);
    expect(values("Date of birth: 3 March 1985")).toEqual(["birthdate:3 March 1985"]);
    expect(values("Tgl. Lahir 12 Januari 1990")).toEqual(["birthdate:12 Januari 1990"]);
  });

  test("each value once, and only the kinds asked for", () => {
    const text = "NIK 3201234507900001 ... NIK 3201234507900001, HP 081234567890";
    expect(findPii(text).length).toBe(2);
    expect(findPii(text, ["phone"]).map((m) => m.kind)).toEqual(["phone"]);
  });
});
