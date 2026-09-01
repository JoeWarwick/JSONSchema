# Future Considerations

- Use JSON translation files for per-locale message catalogs if you want the locale content to be easier to maintain or hand off to translators.
- Keep the locale resolution, fallback chain, and typed message access in TypeScript so the app retains compile-time safety.
- If we expand localization later, prefer a thin TypeScript loader over moving the entire i18n layer out of the codebase.
