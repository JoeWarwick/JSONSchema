/**
 * Google Fonts Manager
 * Manages available fonts and dynamic font loading
 */

// Popular Google Fonts
export const AVAILABLE_FONTS = [
  { name: 'System Default', family: 'system-ui' },
  { name: 'Arial', family: 'Arial' },
  { name: 'Georgia', family: 'Georgia' },
  { name: 'Courier New', family: 'Courier New' },
  { name: 'Trebuchet MS', family: 'Trebuchet MS' },
  { name: 'Verdana', family: 'Verdana' },
  { name: 'Open Sans', family: 'Open Sans', googleFont: true },
  { name: 'Roboto', family: 'Roboto', googleFont: true },
  { name: 'Playfair Display', family: 'Playfair Display', googleFont: true },
  { name: 'Lato', family: 'Lato', googleFont: true },
  { name: 'Montserrat', family: 'Montserrat', googleFont: true },
  { name: 'Poppins', family: 'Poppins', googleFont: true },
  { name: 'Inter', family: 'Inter', googleFont: true },
];

// Track loaded fonts to avoid duplicate injections
const loadedFonts = new Set();

/**
 * Load a Google Font dynamically
 */
export const loadGoogleFont = (fontName) => {
  if (loadedFonts.has(fontName)) {
    return Promise.resolve();
  }

  const font = AVAILABLE_FONTS.find(f => f.name === fontName);
  if (!font || !font.googleFont) {
    loadedFonts.add(fontName);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://fonts.googleapis.com';
    document.head.appendChild(link);

    const linkFont = document.createElement('link');
    linkFont.rel = 'stylesheet';
    linkFont.href = `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, '+')}:wght@400;700&display=swap`;
    linkFont.onload = () => {
      loadedFonts.add(fontName);
      resolve();
    };
    linkFont.onerror = reject;
    document.head.appendChild(linkFont);
  });
};

/**
 * Get font family value for CSS
 */
export const getFontFamily = (fontName) => {
  const font = AVAILABLE_FONTS.find(f => f.name === fontName);
  return font ? font.family : 'system-ui';
};

/**
 * Generate CSS class name for font
 */
export const fontToClassName = (fontName) => {
  // Replace spaces with hyphens and convert to lowercase
  const safeName = fontName.replace(/\s+/g, '-').toLowerCase();
  return `font-${safeName}`;
};
