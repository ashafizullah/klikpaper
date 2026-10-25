// Interface language. English is the default; Indonesian follows the same keys.
import en, { type Key } from "./en";
import id from "./id";

export type Locale = "en" | "id";
const dictionaries: Record<Locale, Record<Key, string>> = { en, id };

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem("klikpaper.locale");
    if (saved === "en" || saved === "id") return saved;
  } catch {}
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("id") ? "id" : "en";
}

export const i18n = $state({ locale: initialLocale() as Locale });

export function setLocale(locale: Locale) {
  i18n.locale = locale;
  try {
    localStorage.setItem("klikpaper.locale", locale);
  } catch {}
  document.documentElement.lang = locale;
}

export function translate(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  const text = dictionaries[locale][key] ?? en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Reactive in templates: reads the current locale. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  return translate(i18n.locale, key, vars);
}

export type { Key };
