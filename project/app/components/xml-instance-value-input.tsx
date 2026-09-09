import { readPreferredLocale } from '../i18n/intl';

const COUNTRY_CODES = [
  'US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE',
  'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PT', 'PL', 'CZ', 'HU', 'GR', 'TR',
  'JP', 'KR', 'CN', 'IN', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'BR', 'MX',
  'AR', 'CL', 'CO', 'PE', 'ZA', 'NG', 'EG', 'KE', 'MA',
] as const;

const LANGUAGE_TAGS = [
  'en', 'en-US', 'en-GB', 'fr', 'fr-CA', 'de', 'es', 'es-MX', 'it', 'pt',
  'pt-BR', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'hu', 'el', 'tr', 'ru',
  'uk', 'ja', 'ko', 'zh', 'zh-CN', 'zh-TW', 'ar', 'hi',
] as const;

export function normalizeColorInputValue(value: string): string {
  const trimmed = String(value || '').trim();
  const shortHexMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortHexMatch) {
    const [red, green, blue] = shortHexMatch[1].split('');
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
  }
  const fullHexMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (fullHexMatch) return `#${fullHexMatch[1]}`.toLowerCase();
  return '#000000';
}

function getCountryOptions() {
  const locale = readPreferredLocale();
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'region' })
    : null;

  return COUNTRY_CODES.map((code) => ({ code, label: displayNames?.of(code) || code }));
}

function getLanguageTagOptions() {
  const locale = readPreferredLocale();
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'language' })
    : null;

  return LANGUAGE_TAGS.map((tag) => ({ tag, label: displayNames?.of(tag) || tag }));
}

export function renderCountryInput(
  textValue: string,
  onValueChange: (nextValue: string) => void,
  testId?: string,
) {
  const listId = testId ? `${testId}-country-list` : 'country-list';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 320 }}>
      <input
        data-testid={testId}
        type="text"
        list={listId}
        value={textValue}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Select or type a country"
        style={{ flex: 1, maxWidth: 320, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
      />
      <datalist id={listId}>
        {getCountryOptions().map((country) => <option key={country.code} value={country.label} />)}
      </datalist>
    </div>
  );
}

export function renderLanguageInput(
  textValue: string,
  onValueChange: (nextValue: string) => void,
  testId?: string,
) {
  const listId = testId ? `${testId}-language-list` : 'language-list';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 320 }}>
      <input
        data-testid={testId}
        type="text"
        list={listId}
        value={textValue}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Select or type a language tag"
        style={{ flex: 1, maxWidth: 320, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
      />
      <datalist id={listId}>
        {getLanguageTagOptions().map((language) => <option key={language.tag} value={language.tag} label={language.label} />)}
      </datalist>
    </div>
  );
}

export function renderSimpleValueInput(
  widgetHint: string | null,
  htmlInputType: string,
  textValue: string,
  onValueChange: (nextValue: string) => void,
  testId?: string,
) {
  if (widgetHint === 'lang') return renderLanguageInput(textValue, onValueChange, testId);
  if (widgetHint === 'country') return renderCountryInput(textValue, onValueChange, testId);

  if (htmlInputType !== 'color') {
    return (
      <input
        data-testid={testId}
        type={htmlInputType as any}
        value={textValue}
        onChange={(event) => onValueChange(event.target.value)}
        style={{ flex: 1, maxWidth: 200, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 320 }}>
      <input
        data-testid={testId}
        type="color"
        value={normalizeColorInputValue(textValue)}
        onChange={(event) => onValueChange(event.target.value)}
        style={{ width: 40, height: 30, padding: 0, border: '1px solid #ddd', borderRadius: 3, cursor: 'pointer' }}
      />
      <input
        type="text"
        value={textValue}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="#rrggbb"
        style={{ flex: 1, minWidth: 90, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
      />
    </div>
  );
}