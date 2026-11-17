/**
 * CSS Generator - Idempotent CSS class generator and manager
 * Reads existing CSS, generates deterministic class names, and appends new rules
 * Ensures no duplicate classes are created
 */

// Storage for color/font index mappings (persisted in sessionStorage)
export const getIndexedClassMap = (key) => {
  try {
    const stored = sessionStorage.getItem(`editor-${key}-map`);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

export const setIndexedClassMap = (key, map) => {
  try {
    sessionStorage.setItem(`editor-${key}-map`, JSON.stringify(map));
  } catch {
    // Silently fail if sessionStorage not available
  }
};

/**
 * Get next index for a new color/font
 */
const getNextIndex = (key, valueToSkip = null) => {
  const map = getIndexedClassMap(key);
  let maxIndex = 0;
  
  // Find the highest existing index
  for (const value in map) {
    if (valueToSkip && value === valueToSkip) continue;
    const index = parseInt(map[value]);
    if (index > maxIndex) maxIndex = index;
  }
  
  return maxIndex + 1;
};

/**
 * Get or create indexed class for colors/fonts
 * Returns class name like "color1", "color2", "font1", etc.
 */
const getOrCreateIndexedClass = (key, value) => {
  if (!value) return null;
  
  const map = getIndexedClassMap(key);
  
  // If value already has an index, return it
  if (map[value]) {
    return `${key}${map[value]}`;
  }
  
  // Create new index for this value
  const index = getNextIndex(key);
  map[value] = index;
  setIndexedClassMap(key, map);
  
  return `${key}${index}`;
};

/**
 * Map simple style names to their CSS rules
 */
const getSimpleStyleCSS = (className) => {
  const styleMap = {
    'bold': 'font-weight: bold;',
    'italic': 'font-style: italic;',
    'underline': 'text-decoration: underline;',
  };
  return styleMap[className] || null;
};

/**
 * Merge multiple CSS classes into a single combined class
 * Example: ["bold", "italic"] -> "bold-italic"
 * Returns the combined class name
 */
export const mergeClasses = (classNames) => {
  if (!classNames || classNames.length === 0) return null;
  if (classNames.length === 1) return classNames[0];
  
  // Extract the value part from each class (after the category prefix)
  // "font-weight-bold" -> "bold", "font-style-italic" -> "italic"
  // "color1" -> "color1", "font2" -> "font2" (keep indexed classes as-is)
  const valueParts = classNames.map(className => {
    // Keep indexed classes as-is (color1, font2, size3, etc.)
    if (/^(color|font|size)\d+$/.test(className)) {
      return className;
    }
    
    const parts = className.split('-');
    // Find where the value starts (after category prefix)
    // font-weight-bold: category is "font-weight", value is "bold"
    // font-style-italic: category is "font-style", value is "italic"
    // text-decoration-underline: category is "text-decoration", value is "underline"
    
    // Most have 2-3 parts. Take everything after the first 2-3 parts as value
    if (className.startsWith('font-weight-')) return className.replace('font-weight-', '');
    if (className.startsWith('font-style-')) return className.replace('font-style-', '');
    if (className.startsWith('text-decoration-')) return className.replace('text-decoration-', '');
    if (className.startsWith('font-family-')) return className.replace('font-family-', '');
    if (className.startsWith('font-size-')) return className.replace('font-size-', '');
    if (className.startsWith('text-align-')) return className.replace('text-align-', '');
    
    // For simple style names like "bold", "italic", "underline", return as-is
    return className;
  });
  
  // Deduplicate value parts to avoid names like "bold-italic-bold"
  const uniqueValueParts = [...new Set(valueParts.filter(p => p))];
  
  // Generate combined class name like "bold-italic-underline" or "bold-italic-color1"
  const combinedClassName = uniqueValueParts.join('-');
  
  // Get CSS rules for each class and merge them
  const styleEl = document.getElementById('editor-styles');
  const cssRules = [];
  
  // Collect CSS rules from stylesheet or use default CSS for simple style names
  for (const className of classNames) {
    let foundRule = null;
    
    if (styleEl) {
      const cssText = styleEl.textContent || '';
      const regex = new RegExp(`\\.${className}\\s*{\\s*([^}]+)\\s*}`, 'g');
      const match = regex.exec(cssText);
      if (match) {
        foundRule = match[1].trim();
      }
    }
    
    // If rule not found in stylesheet, use default CSS for simple style names
    if (!foundRule) {
      foundRule = getSimpleStyleCSS(className);
    }
    
    if (foundRule) {
      cssRules.push(foundRule);
    }
  }
  
  if (cssRules.length > 0) {
    // Combine all CSS rules
    const combinedCSSRule = cssRules.join(' ');
    addCSSRule(combinedClassName, combinedCSSRule);
  }
  
  return combinedClassName;
};

/**
 * Parse CSS text and extract class names
 */
const parseCSSClasses = (cssText) => {
  const classSet = new Set();
  const classRegex = /\.([a-zA-Z0-9_-]+)\s*{/g;
  let match;
  while ((match = classRegex.exec(cssText)) !== null) {
    classSet.add(match[1]);
  }
  return classSet;
};

/**
 * Get the style element for editor, or create one if it doesn't exist
 */
const getEditorStyleElement = () => {
  let styleEl = document.getElementById('editor-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'editor-styles';
    document.head.appendChild(styleEl);
  }
  return styleEl;
};

/**
 * Get all existing CSS rules from the style element
 */
const getExistingCSS = () => {
  const styleEl = getEditorStyleElement();
  return styleEl.textContent || '';
};

/**
 * Get set of existing class names
 */
export const getExistingClasses = () => {
  const cssText = getExistingCSS();
  return parseCSSClasses(cssText);
};

/**
 * Generate a deterministic class name from style properties
 * Same input always produces same class name
 */
export const generateClassName = (styleProps) => {
  const parts = [];
  
  // Normalize style properties for deterministic ordering
  const sortedProps = Object.keys(styleProps).sort();
  
  for (const prop of sortedProps) {
    const value = styleProps[prop];
    if (value) {
      // Convert value to safe class name string
      const safeProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      const safeValue = String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      parts.push(`${safeProp}-${safeValue}`);
    }
  }
  
  return parts.length > 0 ? parts.join('-') : null;
};

/**
 * Add a CSS rule to the stylesheet
 * Returns the class name if successful, null if class already exists
 */
export const addCSSRule = (className, cssRule) => {
  const existingClasses = getExistingClasses();
  
  // If class already exists, don't add it again (idempotent)
  if (existingClasses.has(className)) {
    return className;
  }
  
  const styleEl = getEditorStyleElement();
  const currentCSS = styleEl.textContent || '';
  
  // Append new rule
  const newRule = `.${className} { ${cssRule} }`;
  styleEl.textContent = currentCSS + '\n' + newRule;
  
  return className;
};

/**
 * Generate and apply a color class with indexed naming
 * Returns the class name (e.g., "color1", "color2")
 */
export const applyColorStyle = (colorValue, colorName) => {
  if (!colorValue) return null;
  
  const className = getOrCreateIndexedClass('color', colorValue);
  const cssRule = `color: ${colorValue};`;
  return addCSSRule(className, cssRule);
};

/**
 * Generate and apply a font class with indexed naming
 * Returns the class name (e.g., "font1", "font2")
 */
export const applyFontStyle = (fontFamily, fontName) => {
  if (!fontFamily) return null;
  
  const className = getOrCreateIndexedClass('font', fontFamily);
  const cssRule = `font-family: "${fontFamily}", sans-serif;`;
  return addCSSRule(className, cssRule);
};

/**
 * Generate and apply a font size class with indexed naming
 * Returns the class name (e.g., "size1", "size2")
 */
export const applyFontSizeStyle = (fontSize) => {
  if (!fontSize) return null;
  
  const className = getOrCreateIndexedClass('size', fontSize);
  const cssRule = `font-size: ${fontSize};`;
  return addCSSRule(className, cssRule);
};

/**
 * Generate and apply text alignment class
 * Alignment is mutually exclusive (radio button) - removes other alignment classes
 * Returns the class name (e.g., "left", "center", "right", "justify")
 */
export const applyTextAlignStyle = (alignment) => {
  // Use simple alignment value as class name: "left", "center", "right", "justify"
  const className = alignment;
  
  if (!className) return null;
  
  const cssRule = `text-align: ${alignment};`;
  return addCSSRule(className, cssRule);
};

/**
 * Ensure a CSS rule exists for a given class name
 * For simple style names like "bold", "italic", "underline", creates the CSS rule
 * For other names, checks if it already exists
 */
export const ensureClassCSS = (className) => {
  if (!className) return;
  
  const existingClasses = getExistingClasses();
  if (existingClasses.has(className)) return; // Already exists
  
  // Check if it's a simple style name that needs CSS
  const simpleCSS = getSimpleStyleCSS(className);
  if (simpleCSS) {
    addCSSRule(className, simpleCSS);
  }
};

/**
 * Detect whether the active toolbar is using the Tailwind UIframework styling mode.
 * Used to add Tailwind-equivalent utility classes to generated spans.
 */
export const isTailwindUIFrameworkActive = () => {
  try {
    return document.querySelector('.toolbar[data-ui-framework="tailwind"], .toolbar.ui-framework-tailwind') !== null;
  } catch {
    return false;
  }
};

/**
 * Detect whether the active toolbar is using the Bootstrap UIframework styling mode.
 */
export const isBootstrapUIFrameworkActive = () => {
  try {
    return document.querySelector('.toolbar[data-ui-framework="bootstrap"], .toolbar.ui-framework-bootstrap') !== null;
  } catch {
    return false;
  }
};

const TAILWIND_FONT_CLASS_MAP = {
  'System Default': 'font-sans',
  Arial: 'font-sans',
  Georgia: 'font-serif',
  'Courier New': 'font-mono',
  'Trebuchet MS': 'font-sans',
  Verdana: 'font-sans',
  'Open Sans': 'font-sans',
  Roboto: 'font-sans',
  'Playfair Display': 'font-serif',
  Lato: 'font-sans',
  Montserrat: 'font-sans',
  Poppins: 'font-sans',
  Inter: 'font-sans',
};

const TAILWIND_SIZE_CLASS_MAP = {
  '12px': 'text-xs',
  '14px': 'text-sm',
  '16px': 'text-base',
  '18px': 'text-lg',
  '20px': 'text-xl',
  '24px': 'text-2xl',
  '28px': 'text-3xl',
  '32px': 'text-4xl',
};

const BOOTSTRAP_SIZE_CLASS_MAP = {
  '12px': 'fs-6',
  '14px': 'fs-5',
  '16px': 'fs-4',
  '18px': 'fs-3',
  '20px': 'fs-2',
  '24px': 'fs-1',
};

/**
 * Get Bootstrap utility classes that correspond to a generated editor style.
 */
export const getBootstrapUtilityClasses = ({ styleCategory, className, categoryValue }) => {
  const classes = [];

  switch (styleCategory) {
    case 'font-weight':
      if (className === 'bold' || className === 'font-bold') classes.push('fw-bold');
      break;
    case 'font-style':
      if (className === 'italic') classes.push('fst-italic');
      break;
    case 'text-decoration':
      if (className === 'underline') classes.push('text-decoration-underline');
      break;
    case 'text-align':
      if (className === 'left') classes.push('text-start');
      if (className === 'center') classes.push('text-center');
      if (className === 'right') classes.push('text-end');
      if (className === 'justify') classes.push('text-justify');
      break;
    case 'color':
      // Bootstrap has semantic color utilities (text-primary, text-success, etc.).
      // For arbitrary hex/rgb values we don't have direct Bootstrap equivalents,
      // so return empty array to let the generated indexed class handle the styling.
      break;
    case 'font':
      // Bootstrap doesn't provide font-family utility classes like Tailwind.
      // Let the indexed/generated class handle explicit font-family rules.
      break;
    case 'size':
      if (categoryValue) classes.push(BOOTSTRAP_SIZE_CLASS_MAP[categoryValue] || null);
      break;
    default:
      break;
  }

  // Filter out null/empty entries
  return classes.filter(Boolean);
};

/**
 * Get Tailwind utility classes that correspond to a generated editor style.
 */
export const getTailwindUtilityClasses = ({ styleCategory, className, categoryValue }) => {
  const classes = [];

  switch (styleCategory) {
    case 'font-weight':
      if (className === 'bold') classes.push('font-bold');
      break;
    case 'font-style':
      if (className === 'italic') classes.push('italic');
      break;
    case 'text-decoration':
      if (className === 'underline') classes.push('underline');
      break;
    case 'text-align':
      if (['left', 'center', 'right', 'justify'].includes(className)) {
        classes.push(`text-${className}`);
      }
      break;
    case 'color':
      if (categoryValue) classes.push(`text-[${categoryValue}]`);
      break;
    case 'font':
      if (categoryValue) classes.push(TAILWIND_FONT_CLASS_MAP[categoryValue] || 'font-sans');
      break;
    case 'size':
      if (categoryValue) classes.push(TAILWIND_SIZE_CLASS_MAP[categoryValue] || `text-[${categoryValue}]`);
      break;
    default:
      break;
  }

  return classes;
};

/**
 * Generate and apply bold text style
 * Returns the class name 'bold' - CSS rule created when merged or applied
 */
export const applyBoldStyle = () => {
  return 'bold';
};

/**
 * Generate and apply italic text style
 * Returns the class name 'italic' - CSS rule created when merged or applied
 */
export const applyItalicStyle = () => {
  return 'italic';
};

/**
 * Generate and apply underline text style
 * Returns the class name 'underline' - CSS rule created when merged or applied
 */
export const applyUnderlineStyle = () => {
  return 'underline';
};

/**
 * Get current CSS content
 */
export const getCSSContent = () => {
  return getExistingCSS();
};

/**
 * Get all classes currently in use in the editor DOM
 */
const getUsedClasses = (editorElement) => {
  if (!editorElement) return new Set();
  
  const usedClasses = new Set();
  
  // Walk through all elements in the editor
  const walker = document.createTreeWalker(
    editorElement,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    const classList = node.classList;
    for (let i = 0; i < classList.length; i++) {
      const className = classList[i];
      // Only track style-related classes (those we generate)
      if (className && /^[a-z0-9_-]+$/.test(className)) {
        usedClasses.add(className);
      }
    }
  }
  
  return usedClasses;
};

/**
 * Clean up unused CSS rules from the stylesheet
 * Removes CSS rules for classes that are not currently used in the editor
 * Returns object with statistics about cleanup
 */
export const cleanupUnusedCSS = (editorElement) => {
  if (!editorElement) return { removed: 0, kept: 0 };
  
  // Check ALL editors in the document, not just the current one
  // This prevents deleting CSS rules that are used in other editors
  const allUsedClasses = new Set();
  const allEditors = document.querySelectorAll('[contenteditable="true"]');
  
  for (const editor of allEditors) {
    const editorClasses = getUsedClasses(editor);
    for (const className of editorClasses) {
      allUsedClasses.add(className);
    }
  }
  
  const definedClasses = getExistingClasses();
  
  // Find classes that are defined but not used in ANY editor
  const unusedClasses = new Set(
    [...definedClasses].filter(className => !allUsedClasses.has(className))
  );
  
  if (unusedClasses.size === 0) {
    return { removed: 0, kept: definedClasses.size };
  }
  
  // Rebuild CSS with only used classes
  const styleEl = getEditorStyleElement();
  const cssText = styleEl.textContent || '';
  
  let cleanedCSS = cssText;
  
  // Remove each unused class rule
  for (const unusedClass of unusedClasses) {
    const regex = new RegExp(`\\.${unusedClass}\\s*{\\s*[^}]+\\s*}`, 'g');
    cleanedCSS = cleanedCSS.replace(regex, '');
  }
  
  // Clean up extra whitespace
  cleanedCSS = cleanedCSS
    .split('\n')
    .filter(line => line.trim())
    .join('\n');
  
  styleEl.textContent = cleanedCSS;
  
  return {
    removed: unusedClasses.size,
    kept: allUsedClasses.size,
    removedClasses: Array.from(unusedClasses).sort()
  };
};

/**
 * Clear all generated CSS (for testing/reset)
 */
export const clearCSS = () => {
  const styleEl = getEditorStyleElement();
  styleEl.textContent = '';
};
