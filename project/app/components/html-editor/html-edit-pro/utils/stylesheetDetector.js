/**
 * Stylesheet Detection Utility
 * Detects CSS frameworks (Tailwind, Bootstrap, Material Design) and icon libraries (Font Awesome, Bootstrap Icons, etc.)
 */

/**
 * Detect attached stylesheets in HTML content
 * @param {string} htmlContent - HTML string to analyze
 * @returns {Object} { tailwind, bootstrap, material, fontAwesome, bootstrapIcons, featherIcons, ionicons }
 */
export function detectStylesheets(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return {
      tailwind: false,
      bootstrap: false,
      material: false,
      fontAwesome: false,
      bootstrapIcons: false,
      featherIcons: false,
      ionicons: false,
    };
  }

  const result = {
    tailwind: false,
    bootstrap: false,
    material: false,
    fontAwesome: false,
    bootstrapIcons: false,
    featherIcons: false,
    ionicons: false,
  };

  // Parse HTML string to detect frameworks
  try {
    // Create a temporary DOM parser to safely analyze the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Get all link tags
    const linkTags = doc.querySelectorAll('link[href]');
    linkTags.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;

      // Tailwind CSS detection
      if (href.includes('tailwindcss') || href.includes('cdn.tailwindcss')) {
        result.tailwind = true;
      }

      // Bootstrap detection
      if (
        href.includes('bootstrap') &&
        !href.includes('bootstrap-icons') &&
        (href.includes('css') || href.includes('cdn'))
      ) {
        result.bootstrap = true;
      }

      // Material Design detection (Google Fonts for Roboto, Material Icons, etc.)
      if (href.includes('fonts.googleapis.com') && href.includes('Roboto')) {
        result.material = true;
      }
      if (href.includes('material-icons') || href.includes('materialsymbols')) {
        result.material = true;
      }

      // Material UI library detection
      if (href.includes('@mui') || href.includes('@material-ui')) {
        result.material = true;
      }

      // Font Awesome detection
      if (href.includes('fontawesome') || href.includes('font-awesome') || href.includes('fa-')) {
        result.fontAwesome = true;
      }

      // Bootstrap Icons detection
      if (href.includes('bootstrap-icons') || (href.includes('bootstrap') && href.includes('icon'))) {
        result.bootstrapIcons = true;
      }

      // Feather Icons detection
      if (href.includes('feather') && (href.includes('icon') || href.includes('css'))) {
        result.featherIcons = true;
      }

      // Ionicons detection
      if (href.includes('ionicons') || href.includes('ionic/icons')) {
        result.ionicons = true;
      }
    });

    // Get all style tags
    const styleTags = doc.querySelectorAll('style');
    styleTags.forEach((style) => {
      const content = style.textContent || '';

      // Tailwind class detection (e.g., .flex, .grid, .text-*, .bg-*)
      if (/\.(flex|grid|text-|bg-|border-|p-|m-|w-|h-|rounded)/.test(content)) {
        result.tailwind = true;
      }

      // Bootstrap class detection (e.g., .container, .row, .col-, .btn)
      if (/\.(container|row|col-|btn|navbar|card|modal|dropdown)/.test(content)) {
        result.bootstrap = true;
      }

      // Material Design detection (e.g., Material icon fonts, Material Design utilities)
      if (
        /Roboto|MaterialIcons|material-icons|Material Symbol|Icon Button/.test(content)
      ) {
        result.material = true;
      }

      // Material UI and Material Components Web detection
      if (/\.Mui|\.mdc-|@material-ui|@mui\//.test(content)) {
        result.material = true;
      }

      // Material Design color system detection (specific Material colors)
      if (/primary(?:\s*:|--)|accent(?:\s*:|--)|warn(?:\s*:|--)|#F57C00|#00BCD4|#E91E63/.test(content)) {
        result.material = true;
      }

      // Font Awesome class detection
      if (/\.fa|fa-[a-z-]+/.test(content)) {
        result.fontAwesome = true;
      }

      // Bootstrap Icons class detection
      if (/\.bi|bi-[a-z-]+/.test(content)) {
        result.bootstrapIcons = true;
      }

      // Feather Icons class detection
      if (/feather|feather-[a-z-]+/.test(content)) {
        result.featherIcons = true;
      }

      // Ionicons class detection
      if (/ion-[a-z-]+|ionicon/.test(content)) {
        result.ionicons = true;
      }
    });

    // Additional CDN pattern detection in script tags (for framework-specific scripts)
    const scriptTags = doc.querySelectorAll('script[src]');
    scriptTags.forEach((script) => {
      const src = script.getAttribute('src');
      if (!src) return;

      if (src.includes('tailwindcss')) {
        result.tailwind = true;
      }
      if (src.includes('bootstrap') && src.includes('js')) {
        result.bootstrap = true;
      }

      // Material UI and Material Components Web script detection
      if (src.includes('@mui') || src.includes('@material-ui') || src.includes('mdc')) {
        result.material = true;
      }

      // Font Awesome script detection
      if (src.includes('fontawesome') || src.includes('font-awesome')) {
        result.fontAwesome = true;
      }

      // Bootstrap Icons script detection
      if (src.includes('bootstrap-icons')) {
        result.bootstrapIcons = true;
      }

      // Feather Icons script detection
      if (src.includes('feather')) {
        result.featherIcons = true;
      }

      // Ionicons script detection
      if (src.includes('ionicons')) {
        result.ionicons = true;
      }
    });
  } catch (error) {
    // Fallback to string-based detection if DOMParser fails
    console.warn('DOMParser failed, using string-based detection:', error);
    return detectStylesheetsFallback(htmlContent);
  }

  return result;
}

/**
 * Fallback detection using regex/string matching
 * Used if DOMParser fails or for simpler scanning
 * @param {string} htmlContent - HTML string to analyze
 * @returns {Object} { tailwind: boolean, bootstrap: boolean, material: boolean }
 */
function detectStylesheetsFallback(htmlContent) {
  const result = {
    tailwind: false,
    bootstrap: false,
    material: false,
    fontAwesome: false,
    bootstrapIcons: false,
    featherIcons: false,
    ionicons: false,
  };

  // Tailwind detection
  if (/tailwindcss|cdn\.tailwindcss/.test(htmlContent)) {
    result.tailwind = true;
  }
  // Tailwind utility class patterns
  if (/class=["'][^"']*\b(flex|grid|text-|bg-|border-|p-|m-|w-|h-|rounded)/.test(htmlContent)) {
    result.tailwind = true;
  }

  // Bootstrap detection
  if (/bootstrap.*css|cdn.*bootstrap/.test(htmlContent)) {
    result.bootstrap = true;
  }
  // Bootstrap class patterns
  if (/class=["'][^"']*\b(container|row|col-|btn|navbar|card|modal|dropdown)/.test(htmlContent)) {
    result.bootstrap = true;
  }

  // Material Design detection
  if (/fonts\.googleapis\.com.*Roboto|material-icons|Material.*Icon|material.*symbol/i.test(htmlContent)) {
    result.material = true;
  }

  // Material UI library detection
  if (/@mui|@material-ui|\.Mui|\.mdc-|material-ui/.test(htmlContent)) {
    result.material = true;
  }

  // Material Design class patterns (MuiButton, MuiCard, mdc-button, etc.)
  if (/class=["'][^"']*\b(Mui|mdc-|material-|md-)/.test(htmlContent)) {
    result.material = true;
  }

  // Material Design color system detection
  if (/primary(?:\s*:|--)|accent(?:\s*:|--)|warn(?:\s*:|--)|#F57C00|#00BCD4|#E91E63/.test(htmlContent)) {
    result.material = true;
  }

  // Font Awesome detection
  if (/fontawesome|font-awesome|class=(['\"])[^'\"]*\bfa\b|class=(['\"])[^'\"]*\bfa-/.test(htmlContent)) {
    result.fontAwesome = true;
  }

  // Bootstrap Icons detection
  if (/bootstrap-icons|class=(['\"])[^'\"]*\bbi\b|class=(['\"])[^'\"]*\bbi-/.test(htmlContent)) {
    result.bootstrapIcons = true;
  }

  // Feather Icons detection
  if (/feather|feather-icons|class=(['\"])[^'\"]*\bfeather-/.test(htmlContent)) {
    result.featherIcons = true;
  }

  // Ionicons detection
  if (/ionicons|ion-icon|class=(['\"])[^'\"]*\bion-/.test(htmlContent)) {
    result.ionicons = true;
  }

  return result;
}

/**
 * Get a human-readable description of detected frameworks
 * @param {Object} detectedStylesheets - { tailwind: boolean, bootstrap: boolean, material: boolean }
 * @returns {string} Comma-separated list of detected frameworks, or "None detected"
 */
export function getDetectionSummary(detectedStylesheets) {
  const detected = Object.keys(detectedStylesheets)
    .filter((key) => detectedStylesheets[key] === true)
    .map((key) => {
      if (key === 'tailwind') return 'Tailwind CSS';
      if (key === 'bootstrap') return 'Bootstrap';
      if (key === 'material') return 'Material Design';
      return key;
    });

  return detected.length > 0 ? detected.join(', ') : 'None detected';
}
