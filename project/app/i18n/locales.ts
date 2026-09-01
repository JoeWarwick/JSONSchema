export const SUPPORTED_LOCALES = ["en", "fr", "de", "es", "zh-CN"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_STORAGE_KEY = "schema-sculptor-locale";

export function normalizeLocaleTag(value: string | null | undefined): SupportedLocale {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_LOCALE;

  const lower = raw.toLowerCase();
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === lower);
  if (exact) return exact;

  const languageOnly = lower.split(/[-_]/)[0];
  const partial = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().startsWith(`${languageOnly}-`));
  if (partial) return partial;

  return DEFAULT_LOCALE;
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
}
