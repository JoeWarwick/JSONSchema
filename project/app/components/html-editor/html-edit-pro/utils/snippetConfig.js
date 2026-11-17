/**
 * Snippet Configuration
 * Central repository for framework demo URLs and help text
 * URLs can be configured via environment variables (VITE_*) or customized here
 *
 * Configuration Priority:
 * 1. Environment variables (VITE_TAILWIND_DEMO_URL, etc.)
 * 2. Hardcoded defaults in this file
 */

const getEnvUrl = (envVar, defaultValue) => {
  if (typeof process !== 'undefined' && process.env?.[envVar]) {
    return process.env[envVar];
  }
  return defaultValue;
};

export const SNIPPET_FRAMEWORKS = {
  tailwind: {
    id: 'tailwind',
    name: 'Tailwind CSS',
    detected: false,
    primary: getEnvUrl(
      'VITE_TAILWIND_DEMO_URL',
      'https://tailwindui.com/preview'
    ),
    fallback: getEnvUrl(
      'VITE_TAILWIND_DOCS_URL',
      'https://tailwindcss.com/docs/components'
    ),
    helpText:
      'Visit Tailwind UI or the official Tailwind docs to explore pre-built components. Copy the HTML code and paste it below, then click Insert to add it at your cursor.',
    buttonLabel: 'Open Tailwind UI',
  },
  bootstrap: {
    id: 'bootstrap',
    name: 'Bootstrap',
    detected: false,
    url: getEnvUrl(
      'VITE_BOOTSTRAP_DOCS_URL',
      'https://getbootstrap.com/docs/5.3/components/'
    ),
    helpText:
      "Browse Bootstrap's component library to find ready-to-use HTML components. Copy the code, paste it below, and click Insert to add it to your editor.",
    buttonLabel: 'Open Bootstrap Docs',
  },
  material: {
    id: 'material',
    name: 'Material Design',
    detected: false,
    url: getEnvUrl(
      'VITE_MATERIAL_DESIGN_URL',
      'https://material.io/components'
    ),
    helpText:
      'Explore Material Design components and patterns. Copy the HTML code (or adapt the component structure), paste it below, and click Insert to add it to your editor.',
    buttonLabel: 'Open Material Design',
  },
  fontAwesome: {
    id: 'fontAwesome',
    name: 'Font Awesome',
    detected: false,
    url: getEnvUrl(
      'VITE_FONT_AWESOME_URL',
      'https://fontawesome.com/icons'
    ),
    helpText:
      'Browse the Font Awesome icon library to find the icons you need. Copy the HTML code (e.g., <i class="fas fa-star"></i>), paste it below, and click Insert to add it to your editor.',
    buttonLabel: 'Open Font Awesome Icons',
  },
  bootstrapIcons: {
    id: 'bootstrapIcons',
    name: 'Bootstrap Icons',
    detected: false,
    url: getEnvUrl(
      'VITE_BOOTSTRAP_ICONS_URL',
      'https://icons.getbootstrap.com/'
    ),
    helpText:
      'Explore the Bootstrap Icons library. Copy the SVG or HTML code, paste it below, and click Insert to add it to your editor.',
    buttonLabel: 'Open Bootstrap Icons',
  },
  featherIcons: {
    id: 'featherIcons',
    name: 'Feather Icons',
    detected: false,
    url: getEnvUrl(
      'VITE_FEATHER_ICONS_URL',
      'https://feathericons.com/'
    ),
    helpText:
      'Browse Feather Icons and copy the SVG or HTML code. Paste it below and click Insert to add it to your editor.',
    buttonLabel: 'Open Feather Icons',
  },
  ionicons: {
    id: 'ionicons',
    name: 'Ionicons',
    detected: false,
    url: getEnvUrl(
      'VITE_IONICONS_URL',
      'https://ionicons.com/'
    ),
    helpText:
      'Explore the Ionicons library. Copy the HTML or SVG code, paste it below, and click Insert to add it to your editor.',
    buttonLabel: 'Open Ionicons',
  },
};

export function getFrameworkConfig(frameworkId) {
  return SNIPPET_FRAMEWORKS[frameworkId] || null;
}

export function getFrameworkUrl(frameworkId) {
  const config = SNIPPET_FRAMEWORKS[frameworkId];
  if (!config) return null;
  return config.primary || config.url;
}

export function getDetectedFrameworks(detectedStylesheets) {
  if (!detectedStylesheets) return [];
  return Object.keys(SNIPPET_FRAMEWORKS).filter((id) => detectedStylesheets[id] === true);
}

export function getPrimaryDetectedFramework(detectedStylesheets) {
  const detectedFrameworks = getDetectedFrameworks(detectedStylesheets);
  return detectedFrameworks.length > 0 ? detectedFrameworks[0] : null;
}