import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, normalizeLocaleTag, type SupportedLocale } from "./locales";

export type MessageArgs = Record<string, string | number | boolean | null | undefined>;

export function readPreferredLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved) return normalizeLocaleTag(saved);
  } catch {
    // ignore storage failures
  }

  return normalizeLocaleTag(window.navigator.language);
}

export function formatMessage(template: string, args?: MessageArgs): string {
  if (!args) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = args[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function createIntlHelpers(locale: SupportedLocale) {
  return {
    locale,
    number: new Intl.NumberFormat(locale),
    dateTime: new Intl.DateTimeFormat(locale),
    list: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }),
    relativeTime: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
  };
}
