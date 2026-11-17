import DOMPurify from 'dompurify';

const FORBIDDEN_TAGS = [
  'base',
  'embed',
  'form',
  'iframe',
  'link',
  'meta',
  'object',
  'script',
  'style',
  'template',
  'title',
];

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Sanitize HTML that will be stored in or inserted into the editor.
 * DOMPurify removes event-handler attributes and unsafe URL values by default.
 */
export const sanitizeEditorHTML = (html) => {
  if (typeof html !== 'string') return '';

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: ['srcdoc'],
    ALLOW_DATA_ATTR: false,
    RETURN_TRUSTED_TYPE: false,
  });
};

const isDataImageUrl = (value) => /^data:image\/(?:gif|jpe?g|png|webp|bmp|avif);base64,/i.test(value);

/**
 * Validate a URL before passing it to execCommand or an editor-created element.
 * Relative URLs are allowed and are resolved against the current document.
 */
export const getSafeEditorURL = (value, type = 'link') => {
  if (typeof value !== 'string' || !value.trim()) return null;

  const trimmedValue = value.trim();
  if (type === 'image' && isDataImageUrl(trimmedValue)) return trimmedValue;
  if (/^data:/i.test(trimmedValue) || /^javascript:/i.test(trimmedValue) || /^vbscript:/i.test(trimmedValue)) {
    return null;
  }

  try {
    const url = new URL(trimmedValue, document.baseURI);
    const allowedProtocols = type === 'image' ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS;
    return allowedProtocols.has(url.protocol) ? trimmedValue : null;
  } catch {
    return null;
  }
};