// Finding personal data in a page's text, for blacking it out in one go:
// Indonesian ID numbers (NIK) and tax numbers (NPWP), mobile numbers, email
// addresses, bank account and card numbers, and dates of birth. Numbers are
// checked, not only matched (a NIK's province and birth date, a card's Luhn
// digit), and account numbers and birth dates are only taken next to a word
// that says what they are, so ordinary numbers and dates stay. It is a help,
// not a guarantee: the user reviews every find before anything is marked.
// Kept free of the app's state modules so it can be tested on its own.

export type PiiKind = "nik" | "npwp" | "phone" | "email" | "account" | "birthdate";

export const PII_KINDS: PiiKind[] = ["nik", "npwp", "phone", "email", "account", "birthdate"];

export interface PiiMatch {
  kind: PiiKind;
  /** The text as it is on the page (what gets blacked out). */
  value: string;
}

/**
 * A run of digits that may be split by up to three spaces, dots, dashes or
 * brackets ("3201 2345", "0812 - 3456", "(+62) 812"), or a line break: text read
 * from a tilted scan can break a number where its digits climb to the next line.
 */
interface Run {
  start: number;
  /** The digit groups, each with where it starts in the text. */
  groups: { start: number; digits: string }[];
}

function digitRuns(text: string): Run[] {
  const runs: Run[] = [];
  const re = /\d(?:[ .\-()\n]{0,3}\d)*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const groups: Run["groups"] = [];
    const part = /\d+/g;
    for (let g = part.exec(m[0]); g; g = part.exec(m[0])) groups.push({ start: m.index + g.index, digits: g[0] });
    runs.push({ start: m.index, groups });
  }
  return runs;
}

/** Whole groups of a run whose digits add up to `lengths`: the text they span and the digits. */
function* windows(text: string, run: Run, lengths: (n: number) => boolean): Generator<{ start: number; end: number; digits: string }> {
  const g = run.groups;
  for (let i = 0; i < g.length; i++) {
    let digits = "";
    for (let j = i; j < g.length; j++) {
      digits += g[j].digits;
      if (digits.length > 20) break;
      if (lengths(digits.length)) yield { start: g[i].start, end: g[j].start + g[j].digits.length, digits };
    }
  }
}

/** A NIK: province 11–99, then a birth date (day + 40 for women) as DDMMYY. */
export function isNik(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  const province = Number(digits.slice(0, 2));
  const day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  return province >= 11 && ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && month >= 1 && month <= 12 && digits.slice(12) !== "0000";
}

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** Words that say the number after them is an account or card number. */
const ACCOUNT_WORDS = /\b(no(?:mor)?\.?\s*rek(?:ening)?|rekening|rek\.|account(?:\s*(?:number|no\.?))?|acc\.?\s*no\.?|a\/c|virtual\s*account|kartu|card(?:\s*number)?|bca|bri|bni|mandiri|bsi|btn|cimb(?:\s*niaga)?|permata|danamon|ocbc|maybank|jago|seabank|jenius)\b/gi;
const NPWP_WORD = /\bnpwp\b/gi;
const BIRTH_WORDS = /\b(tanggal\s*lahir|tgl\.?\s*lahir|tempat\s*\/?\s*tgl\.?\s*lahir|tempat\s*,?\s*tanggal\s*lahir|ttl|lahir|date\s*of\s*birth|birth\s*date|dob)\b/gi;
const MONTHS = "jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?";
const DATE = new RegExp(`\\d{1,2}\\s*[-/.]\\s*\\d{1,2}\\s*[-/.]\\s*\\d{2,4}|\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}|\\d{4}\\s*-\\s*\\d{2}\\s*-\\s*\\d{2}`, "i");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const NPWP_FORMATTED = /\d{2}\s?\.\s?\d{3}\s?\.\s?\d{3}\s?\.\s?\d\s?-\s?\d{3}\s?\.\s?\d{3}/g;

/**
 * The text right after each keyword match: the rest of its line and the next
 * one, since a form may put the value under its label, and text read from a
 * tilted scan can put every word on a line of its own.
 */
function after(text: string, words: RegExp, reach: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  words.lastIndex = 0;
  for (let m = words.exec(text); m; m = words.exec(text)) {
    const from = m.index + m[0].length;
    const eol = text.indexOf("\n", from);
    const next = eol < 0 ? -1 : text.indexOf("\n", eol + 1);
    out.push({ from, to: Math.min(from + reach, next < 0 ? text.length : next) });
  }
  return out;
}

/** The personal data in a page's text, each value once per kind. */
export function findPii(text: string, kinds: PiiKind[] = PII_KINDS): PiiMatch[] {
  const want = new Set(kinds);
  const found: (PiiMatch & { start: number; end: number })[] = [];
  const add = (kind: PiiKind, start: number, end: number) => {
    if (!want.has(kind)) return;
    // A stretch already taken (an NPWP is not also an account number) stays with its first kind.
    if (found.some((f) => start < f.end && end > f.start)) return;
    found.push({ kind, value: text.slice(start, end).trim(), start, end });
  };

  // Formatted NPWP first: its dots would otherwise read as parts of other numbers.
  NPWP_FORMATTED.lastIndex = 0;
  for (let m = NPWP_FORMATTED.exec(text); m; m = NPWP_FORMATTED.exec(text)) add("npwp", m.index, m.index + m[0].length);

  EMAIL.lastIndex = 0;
  for (let m = EMAIL.exec(text); m; m = EMAIL.exec(text)) add("email", m.index, m.index + m[0].length);

  const runs = digitRuns(text);
  const near = (spans: { from: number; to: number }[], start: number) => spans.some((s) => start >= s.from && start <= s.to);
  const npwpWords = after(text, NPWP_WORD, 30);
  const accountWords = after(text, ACCOUNT_WORDS, 40);
  for (const run of runs) {
    // An unformatted NPWP (15 digits, or the 16-digit NIK form) only after the word NPWP.
    if (near(npwpWords, run.start)) for (const w of windows(text, run, (n) => n === 15 || n === 16)) add("npwp", w.start, w.end);
    // A card number standing alone (before NIKs: a card can look like one) in the usual 4-4-4-4 groups, with a valid check digit.
    for (const w of windows(text, run, (n) => n >= 13 && n <= 19)) {
      const shaped = /^\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}$/.test(text.slice(w.start, w.end));
      if (shaped && luhn(w.digits)) add("account", w.start, w.end);
    }
    for (const w of windows(text, run, (n) => n === 16)) if (isNik(w.digits)) add("nik", w.start, w.end);
    // Mobile numbers: 08… with 10–13 digits, or 62 8… (after a "+" or not) with 11–14.
    for (const w of windows(text, run, (n) => n >= 10 && n <= 14)) {
      const local = /^08[1-9]\d{7,10}$/.test(w.digits);
      const intl = /^628[1-9]\d{7,10}$/.test(w.digits);
      if (!local && !intl) continue;
      // A leading "+" or "(+" is part of the number.
      const plus = text.slice(Math.max(0, w.start - 2), w.start) === "(+" ? 2 : text[w.start - 1] === "+" ? 1 : 0;
      add("phone", w.start - plus, w.end);
    }
    if (near(accountWords, run.start)) {
      // The longest stretch that can be an account (6–20 digits) or card number.
      let best: { start: number; end: number; digits: string } | null = null;
      for (const w of windows(text, run, (n) => n >= 6 && n <= 20)) if (!best || w.digits.length > best.digits.length) best = w;
      if (best) add("account", best.start, best.end);
    }
  }

  for (const span of after(text, BIRTH_WORDS, 50)) {
    const m = DATE.exec(text.slice(span.from, span.to));
    if (m) add("birthdate", span.from + m.index, span.from + m.index + m[0].length);
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.start - b.start)
    .filter((f) => {
      const key = `${f.kind}:${f.value.replace(/[\s.\-]/g, "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ kind, value }) => ({ kind, value }));
}
