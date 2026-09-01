import { DEFAULT_LOCALE, type SupportedLocale } from "./locales";

type MessageValue = string | { one: string; other: string };

type MessageCatalog = Record<string, MessageValue | Record<string, MessageValue>>;

export const messages: Record<SupportedLocale, MessageCatalog> = {
  en: {
    app: {
      title: "Markup Suite - Schema Workbench",
      description: "Generate and modify schemas with intuitive editors and produce form-based editors with validation.",
    },
    common: {
      loading: "Loading…",
      cancel: "Cancel",
      load: "Load",
      save: "Save",
      close: "Close",
    },
    workbench: {
      language: "Language",
      schemaMenu: "Schema",
      markupMenu: "{language} Document",
      aboutTitle: "Schema Sculptor",
      aboutSubtitle: "JSON Schema Workbench",
      aboutDescription: "Generate and modify JSON schemas with an intuitive form-based editor.",
      loadFromUrl: "Load from URL…",
      openFile: "Open {language} file…",
    },
  },
  fr: {},
  de: {},
  es: {},
  "zh-CN": {},
};

export function getMessageCatalog(locale: SupportedLocale): MessageCatalog {
  return messages[locale] || messages[DEFAULT_LOCALE];
}
