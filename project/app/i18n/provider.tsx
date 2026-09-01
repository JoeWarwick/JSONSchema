import React from "react";
import { createIntlHelpers, formatMessage, readPreferredLocale } from "./intl";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, normalizeLocaleTag, type SupportedLocale } from "./locales";
import { getMessageCatalog } from "./messages";

type DictionaryRoot = ReturnType<typeof getMessageCatalog>;

type TranslationContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, args?: Record<string, string | number | boolean | null | undefined>) => string;
  intl: ReturnType<typeof createIntlHelpers>;
};

const defaultTranslationContext: TranslationContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  intl: createIntlHelpers(DEFAULT_LOCALE),
  t: (key, args) => formatMessage(resolveMessage(DEFAULT_LOCALE, key) || key, args),
};

const TranslationContext = React.createContext<TranslationContextValue>(defaultTranslationContext);

function resolvePath(dict: DictionaryRoot, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, segment) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, dict);
}

function resolveMessage(locale: SupportedLocale, key: string): string | undefined {
  const primary = resolvePath(getMessageCatalog(locale), key);
  if (typeof primary === "string") return primary;

  const fallback = resolvePath(getMessageCatalog(DEFAULT_LOCALE), key);
  if (typeof fallback === "string") return fallback;

  return undefined;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<SupportedLocale>(() => readPreferredLocale());

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      document.documentElement.lang = locale;
    } catch {
      // ignore storage / document errors
    }
  }, [locale]);

  const setLocale = React.useCallback((nextLocale: SupportedLocale) => {
    setLocaleState(normalizeLocaleTag(nextLocale));
  }, []);

  const intl = React.useMemo(() => createIntlHelpers(locale), [locale]);

  const value = React.useMemo<TranslationContextValue>(() => ({
    locale,
    setLocale,
    intl,
    t: (key, args) => formatMessage(resolveMessage(locale, key) || key, args),
  }), [intl, locale, setLocale]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useLocale() {
  return React.useContext(TranslationContext);
}

export function useT() {
  return useLocale().t;
}
