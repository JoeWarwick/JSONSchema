/**
 * Editor Helper Functions
 * Wrappers for document.execCommand and DOM manipulation
 */

import { applyBoldStyle, applyItalicStyle, applyUnderlineStyle, mergeClasses, ensureClassCSS, cleanupUnusedCSS, addCSSRule, getIndexedClassMap, setIndexedClassMap, getTailwindUtilityClasses, isTailwindUIFrameworkActive, getBootstrapUtilityClasses, isBootstrapUIFrameworkActive } from './cssGenerator';
import { getSafeEditorURL, sanitizeEditorHTML } from './htmlSanitizer';

/**
 * Extract body content from full HTML document
 * Strips html, head, body, meta tags, style/link tags to leave just the content
 */
export const extractBodyContent = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  
  // Try to find body element first
  let body = div.querySelector('body');
  if (body) {
    // Get all elements that aren't style/meta/link tags
    let content = body.innerHTML;
    return content;
  }
  
  // If no body, remove html/head/meta/style/link/script tags
  const container = document.createElement('div');
  container.innerHTML = html;
  
  // Remove head, style, link, script, meta tags
  container.querySelectorAll('head, style, link, script, meta, title').forEach(el => el.remove());
  
  // If there's an html or body wrapper, get its inner content
  let htmlEl = container.querySelector('html');
  if (htmlEl) {
    let bodyEl = htmlEl.querySelector('body');
    return (bodyEl || htmlEl).innerHTML;
  }
  
  // Otherwise return the full content with unnecessary tags removed
  return container.innerHTML;
};

/**
 * Get next index for an indexed category (size, color, font)
 */
const getNextIndex = (category) => {
  const map = getIndexedClassMap(category);
  let maxIndex = 0;
  
  for (const value in map) {
    const index = parseInt(map[value]);
    if (index > maxIndex) maxIndex = index;
  }
  
  return maxIndex + 1;
};

/**
 * Map category + value to CSS rule
 */
const getCSSRuleForCategory = (category, value) => {
  if (!value) return null;
  
  switch (category) {
    case 'size':
      return `font-size: ${value};`;
    case 'color':
      return `color: ${value};`;
    case 'font':
      return `font-family: "${value}", sans-serif;`;
    default:
      return null;
  }
};

/**
 * Store index mapping when creating a new one
 */
const createIndexMapping = (category, value, index) => {
  const map = getIndexedClassMap(category);
  map[value] = index;
  setIndexedClassMap(category, map);
};

/**
 * Apply text formatting via CSS classes (for keyboard shortcuts and toolbar)
 */
export const applyTextFormattingCSS = (type) => {
  let className = null;
  
  switch (type) {
    case 'bold':
      className = applyBoldStyle();
      break;
    case 'italic':
      className = applyItalicStyle();
      break;
    case 'underline':
      className = applyUnderlineStyle();
      break;
    default:
      return;
  }
  
  if (className) {
    applyClassToSelection(className);
  }
};

/**
 * Apply a block element to the current selection
 */
const FRAMEWORK_HEADING_CLASS_MAP = {
  tailwind: {
    h1: ['text-4xl', 'font-bold'],
    h2: ['text-3xl', 'font-semibold'],
    h3: ['text-2xl', 'font-semibold'],
  },
  bootstrap: {
    h1: ['display-1'],
    h2: ['display-2'],
    h3: ['display-3'],
  },
  material: {
    h1: [],
    h2: [],
    h3: [],
  },
};

const ALL_HEADING_CLASSES = [
  'text-4xl',
  'text-3xl',
  'text-2xl',
  'font-bold',
  'font-semibold',
  'display-1',
  'display-2',
  'display-3',
];

const getHeadingClassesForFramework = (tagName, framework) => {
  if (!framework || !FRAMEWORK_HEADING_CLASS_MAP[framework]) return [];
  return FRAMEWORK_HEADING_CLASS_MAP[framework][tagName] || [];
};

const removeHeadingFrameworkClasses = (element) => {
  if (!element || !element.classList) return;
  ALL_HEADING_CLASSES.forEach((className) => {
    if (element.classList.contains(className)) {
      element.classList.remove(className);
    }
  });
};

export const applyBlockElement = (tagName, framework) => {
  document.execCommand('formatBlock', false, `<${tagName}>`);

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  let node = selection.anchorNode;
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  const heading = node.closest(tagName);
  if (!heading) return;

  removeHeadingFrameworkClasses(heading);

  if (framework === null) {
    return; // explicit none: do not add framework heading classes
  }

  const headingClasses = getHeadingClassesForFramework(tagName, framework);
  headingClasses.forEach((className) => heading.classList.add(className));
};

/**
 * Get the style category from a class name
 * Examples: "font-weight-bold" -> "font-weight", "color1" -> "color", "font2" -> "font", "size1" -> "size"
 */
const getStyleCategory = (className) => {
  if (!className) return null;

  if (className === 'font-bold') return 'font-weight';
  if (className === 'italic') return 'font-style';
  if (className === 'underline') return 'text-decoration';
  if (/^text-(left|center|right|justify)$/.test(className)) return 'text-align';
  if (/^text-\[(#|rgb|hsl)/.test(className)) return 'color';
  if (/^font-(sans|serif|mono)$/.test(className)) return 'font';
  if (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/.test(className) || /^text-\[.*(px|rem|em|%)\]$/.test(className)) return 'size';
  
  // Handle simple style names
  if (className === 'bold') return 'font-weight';
  if (className === 'font-bold') return 'font-weight';
  if (className === 'italic') return 'font-style';
  if (className === 'underline') return 'text-decoration';
  
  // Handle alignment classes (mutually exclusive)
  if (['left', 'center', 'right', 'justify'].includes(className)) return 'text-align';
  
  // Handle indexed classes (color1, color2, font1, font2, size1, size2)
  if (/^color\d+$/.test(className)) return 'color';
  if (/^font\d+$/.test(className)) return 'font';
  if (/^size\d+$/.test(className)) return 'size';
  
  // Extract prefixed category (everything before the last dash)
  const categoryPatterns = [
    /^font-weight-/,
    /^font-style-/,
    /^text-decoration-/,
    /^font-family-/,
    /^font-size-/,
    /^text-align-/,
  ];
  
  for (const pattern of categoryPatterns) {
    const match = className.match(pattern);
    if (match) {
      return match[0].slice(0, -1); // Remove the trailing dash
    }
  }
  
  return null;
};

/**
 * Check if a specific category is present in a class name
 * Handles both prefixed classes (font-weight-bold) and merged classes (bold-italic-color1)
 */
const hasStyleCategory = (className, category) => {
  if (!className) return false;

  if (category === 'font-weight' && className === 'font-bold') return true;
  if (category === 'font-style' && className === 'italic') return true;
  if (category === 'text-decoration' && className === 'underline') return true;
  if (category === 'text-align' && /^text-(left|center|right|justify)$/.test(className)) return true;
  if (category === 'color' && /^text-\[(#|rgb|hsl)/.test(className)) return true;
  if (category === 'font' && /^font-(sans|serif|mono)$/.test(className)) return true;
  if (category === 'size' && (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/.test(className) || /^text-\[.*(px|rem|em|%)\]$/.test(className))) return true;
  
  // Check prefixed format (e.g., "font-weight-bold")
  if (className.startsWith(category + '-')) return true;
  
  // For merged classes, check if any part belongs to this category
  const mergedValueToCategoryMap = {
    'bold': 'font-weight',
    'font-bold': 'font-weight',
    'italic': 'font-style',
    'underline': 'text-decoration',
    'left': 'text-align',
    'center': 'text-align',
    'right': 'text-align',
    'justify': 'text-align',
  };
  
  const parts = className.split('-');
  for (const part of parts) {
    // Check if this part maps to the category
    if (mergedValueToCategoryMap[part] === category) {
      return true;
    }
    
    // Check if this part is an indexed class matching the category
    // e.g., "size2" for category "size", "color1" for category "color"
    if (category === 'color' && /^color\d+$/.test(part)) return true;
    if (category === 'font' && /^font\d+$/.test(part)) return true;
    if (category === 'size' && /^size\d+$/.test(part)) return true;
  }
  
  return false;
};

/**
 * Remove a specific category from a class name
 * For merged classes like "bold-italic", removes only the parts in that category
 * Also handles indexed classes like "bold-size1" -> "bold" when removing size
 */
const removeCategoryFromClass = (className, categoryToRemove) => {
  if (categoryToRemove === 'font-weight' && className === 'font-bold') return null;
  if (categoryToRemove === 'font-style' && className === 'italic') return null;
  if (categoryToRemove === 'text-decoration' && className === 'underline') return null;
  if (categoryToRemove === 'text-align' && /^text-(left|center|right|justify)$/.test(className)) return null;
  if (categoryToRemove === 'color' && /^text-\[(#|rgb|hsl)/.test(className)) return null;
  if (categoryToRemove === 'font' && /^font-(sans|serif|mono)$/.test(className)) return null;
  if (categoryToRemove === 'size' && (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/.test(className) || /^text-\[.*(px|rem|em|%)\]$/.test(className))) return null;

  // Simple case: prefixed class, entire thing is one category
  if (className.startsWith(categoryToRemove + '-')) {
    return null; // Entire class belongs to this category
  }

  if (categoryToRemove === 'font-weight' && className === 'font-bold') return null;
  
  // For standalone indexed classes, remove if it's the specific category
  if (categoryToRemove === 'size' && /^size\d+$/.test(className)) return null;
  if (categoryToRemove === 'color' && /^color\d+$/.test(className)) return null;
  if (categoryToRemove === 'font' && /^font\d+$/.test(className)) return null;
  
  // For merged classes, remove only the parts in this category
  const mergedValueToCategoryMap = {
    'bold': 'font-weight',
    'italic': 'font-style',
    'underline': 'text-decoration',
    'left': 'text-align',
    'center': 'text-align',
    'right': 'text-align',
    'justify': 'text-align',
  };
  
  const parts = className.split('-');
  const remainingParts = parts.filter(part => {
    // Check if this part matches a value in the merged map
    if (mergedValueToCategoryMap[part] === categoryToRemove) {
      return false; // Remove it
    }
    
    // Check if this part is an indexed class matching the category to remove
    if (categoryToRemove === 'size' && /^size\d+$/.test(part)) return false;
    if (categoryToRemove === 'color' && /^color\d+$/.test(part)) return false;
    if (categoryToRemove === 'font' && /^font\d+$/.test(part)) return false;
    
    return true; // Keep it
  });
  
  return remainingParts.length > 0 ? remainingParts.join('-') : null;
};

/**
 * Apply text formatting (bold, italic, underline)
 */
export const applyTextFormatting = (type) => {
  switch (type) {
    case 'bold':
      document.execCommand('bold', false, null);
      break;
    case 'italic':
      document.execCommand('italic', false, null);
      break;
    case 'underline':
      document.execCommand('underline', false, null);
      break;
    default:
      break;
  }
};

/**
 * Apply list formatting
 */
export const applyList = (type, style = null) => {
  let listElement = null;

  if (type === 'ul') {
    document.execCommand('insertUnorderedList', false, null);
  } else if (type === 'ol') {
    document.execCommand('insertOrderedList', false, null);
  }

  const selection = window.getSelection();
  let node = selection?.focusNode;
  while (node && node !== document.body) {
    if (node.nodeName === type.toUpperCase()) {
      listElement = node;
      break;
    }
    node = node.parentNode;
  }

  if (listElement && style) {
    [...listElement.classList]
      .filter((className) => className.startsWith('list-style-'))
      .forEach((className) => listElement.classList.remove(className));
    listElement.classList.add(`list-style-${style}`);
  }
};

/**
 * Insert a link
 */
export const insertLink = (url) => {
  const safeURL = getSafeEditorURL(url, 'link');
  if (!safeURL) return false;

  document.execCommand('createLink', false, safeURL);
  return true;
};

/**
 * Insert an image
 */
export const insertImage = (url) => {
  const safeURL = getSafeEditorURL(url, 'image');
  if (!safeURL) return false;

  document.execCommand('insertImage', false, safeURL);
  return true;
};

/**
 * Insert a horizontal rule
 */
export const insertHorizontalRule = () => {
  document.execCommand('insertHorizontalRule', false, null);
};

/**
 * Insert code block
 */
export const insertCodeBlock = () => {
  applyBlockElement('pre', null);
};

/**
 * Apply class to current selection, merging with existing classes on same span
 * Can be called with a className string (e.g., "bold", "size1") 
 * Or with an object for indexed categories: { category: 'size', value: '14px' }
 * Removes conflicting classes from the same category
 */
export const applyClassToSelection = (input) => {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const selectedText = range.toString();
  
  // If no selection, nothing to do
  if (!selectedText) return;
  
  // Parse input: could be string (className) or object (category + value)
  let className = input;
  let categoryValue = null; // For indexed categories
  let styleCategory = null;
  
  if (typeof input === 'object' && input.category && input.value) {
    categoryValue = input.value;
    styleCategory = input.category;
    // className will be determined after finding target span
  } else {
    className = input;
    styleCategory = getStyleCategory(className);
  }
  
  const newCategory = styleCategory;
  const framework = isTailwindUIFrameworkActive() ? 'tailwind' : isBootstrapUIFrameworkActive() ? 'bootstrap' : null;
  
  // Get common ancestor container
  let commonNode = range.commonAncestorContainer;
  
  // If it's a text node, get the parent
  if (commonNode.nodeType === 3) {
    commonNode = commonNode.parentNode;
  }
  
  // Check if the common node or any ancestor is a span with style classes
  let targetSpan = null;
  let node = commonNode;
  
  // Known style values that can appear in merged classes or standalone
  const styleValues = ['bold', 'italic', 'underline', 'left', 'center', 'right', 'justify'];
  
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.nodeName === 'SPAN' && node.className) {
      const classes = node.className.split(/\s+/);
      // Check if this span has any style-related classes:
      // - Contains '-' (prefixed format like font-weight-bold)
      // - Indexed classes like color1, font2, size3
      // - Merged value classes like bold, italic, underline
      if (classes.some(c => c.includes('-') || /^(color|font|size)\d+$/.test(c) || styleValues.includes(c))) {
        targetSpan = node;
        break;
      }
    }
    node = node.parentNode;
  }
  
  // If no immediate target span found, check if all selected text is wrapped in style spans
  // This handles cases like nested bold spans where range.commonAncestorContainer is the editor
  if (!targetSpan && commonNode.nodeName !== 'SPAN') {
    const editor = document.querySelector('[contenteditable="true"]');
    if (commonNode === editor || (commonNode.parentNode && commonNode.parentNode === editor)) {
      // Check all spans that contain selected text
      const allSpans = editor.querySelectorAll('span');
      const spansInSelection = [];
      
      for (const span of allSpans) {
        if (range.intersectsNode(span)) {
          spansInSelection.push(span);
        }
      }
      
      // If all selected text is in spans with style classes, use the innermost one
      if (spansInSelection.length > 0) {
        // Find the deepest span (most specific)
        targetSpan = spansInSelection.reduce((deepest, current) => {
          if (!deepest) return current;
          // Check if current is inside deepest (more deeply nested)
          return deepest.contains(current) ? current : deepest;
        }, null);
      }
    }
  }

  // For indexed categories with value provided (e.g., { category: 'size', value: '14px' })
  // Resolve className before using it further
  if (categoryValue && styleCategory && ['color', 'font', 'size'].includes(styleCategory)) {
    if (targetSpan) {
      // Check if span already has an index for this category
      const categoryPattern = new RegExp(styleCategory + '\\d+');
      const existingMatch = targetSpan.className.match(categoryPattern);
      
      if (existingMatch) {
        // Span already has this category with an index, reuse it
        className = existingMatch[0];
        // Update the CSS rule for this index with the new value
        const cssRule = getCSSRuleForCategory(styleCategory, categoryValue);
        if (cssRule) {
          addCSSRule(className, cssRule);
        }
      } else {
        // Span doesn't have this category yet, create a new index
        const newIndex = getNextIndex(styleCategory);
        className = `${styleCategory}${newIndex}`;
        
        // Create the CSS rule for the new index
        const cssRule = getCSSRuleForCategory(styleCategory, categoryValue);
        if (cssRule) {
          addCSSRule(className, cssRule);
        }
        
        // Store the mapping
        createIndexMapping(styleCategory, categoryValue, newIndex);
      }
    } else {
      // No target span found yet, but we have indexed category
      // Create new index for this new span
      const newIndex = getNextIndex(styleCategory);
      className = `${styleCategory}${newIndex}`;
      
      // Create the CSS rule for the new index
      const cssRule = getCSSRuleForCategory(styleCategory, categoryValue);
      if (cssRule) {
        addCSSRule(className, cssRule);
      }
      
      // Store the mapping
      createIndexMapping(styleCategory, categoryValue, newIndex);
    }
  }

  const frameworkUtilityClasses = framework === 'tailwind'
    ? getTailwindUtilityClasses({ styleCategory: newCategory, className, categoryValue })
    : framework === 'bootstrap'
      ? getBootstrapUtilityClasses({ styleCategory: newCategory, className, categoryValue })
      : [];
  
  if (targetSpan) {
    // Determine if this is an indexed category (always replace) or a toggle category (toggle on/off)
    const isIndexedCategory = /^(color|font|size)\d+$/.test(className);
    
    // Check if this category is already applied to this span
    const alreadyHasCategory = hasStyleCategory(targetSpan.className, newCategory);
    
    let newClassName;
    let isMerged = false;
    
    if (!isIndexedCategory && alreadyHasCategory && newCategory !== 'text-align') {
      // For toggle categories (bold, italic, underline): toggle off
      // But NOT for text-align (alignment should always replace, not toggle)
      const remainingClasses = targetSpan.className.split(/\s+/).filter((c) => c && !hasStyleCategory(c, newCategory));
      newClassName = remainingClasses.length > 0 ? remainingClasses.join(' ') : null;
    } else {
      // For indexed categories (color, font, size): always replace the old one
      // OR for text-align: always replace (mutually exclusive)
      // OR for toggle categories when not already applied: add the new one
      // Filter out any existing classes in the same category first, then add the new one
      const existingClasses = targetSpan.className.split(/\s+/).filter(c => c);
      const filteredClasses = existingClasses.filter(c => !hasStyleCategory(c, newCategory));
      const uniqueClasses = [...new Set([
        ...filteredClasses,
        className,
        ...frameworkUtilityClasses,
      ].filter(c => c))];

      if (useTailwindUtilities) {
        newClassName = uniqueClasses.join(' ');
      } else if (uniqueClasses.length > 1) {
        newClassName = mergeClasses(uniqueClasses);
        isMerged = true;
      } else {
        newClassName = uniqueClasses.join(' ');
      }
    }
    
    // Update or remove the span
    if (newClassName) {
      targetSpan.className = newClassName;
      // Ensure CSS exists for the final class name
      // For merged classes with multiple parts, we need to re-merge to ensure CSS is created
      if (newClassName.includes('-') && !newClassName.includes(' ')) {
        // This is a merged class - ensure CSS exists for it
        const parts = newClassName.split('-');
        mergeClasses(parts);
      } else {
        // Single class - ensure CSS exists (only if not already merged from toggle-on)
        if (!isMerged) {
          newClassName.split(/\s+/).filter(Boolean).forEach((classToken) => {
            ensureClassCSS(classToken);
          });
        }
      }
      // Clean up any unused CSS rules from previous states
      // Find the editor containing this target span
      let editor = targetSpan;
      while (editor && editor.contentEditable !== 'true') {
        editor = editor.parentNode;
      }
      if (editor) cleanupUnusedCSS(editor);
    } else {
      // No styles left, remove the span and unwrap the text
      while (targetSpan.firstChild) {
        targetSpan.parentNode.insertBefore(targetSpan.firstChild, targetSpan);
      }
      const parentToCheck = targetSpan.parentNode;
      targetSpan.parentNode.removeChild(targetSpan);
      
      // Also unwrap any parent spans that have only this class
      // This handles nested spans like <span class="bold"><span class="bold">text</span></span>
      let parent = parentToCheck;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (parent.nodeName === 'SPAN' && parent.className === className) {
          // Parent has the exact same single class - it's now unnecessary
          const parentParent = parent.parentNode;
          while (parent.firstChild) {
            parentParent.insertBefore(parent.firstChild, parent);
          }
          parentParent.removeChild(parent);
          parent = parentParent; // Continue checking the next parent
        } else {
          break; // Stop if parent is not a span or has other classes
        }
      }
      
      // Clean up unused CSS rules
      // Find the editor containing this span
      let editor = parentToCheck;
      while (editor && editor.contentEditable !== 'true') {
        editor = editor.parentNode;
      }
      if (editor) cleanupUnusedCSS(editor);
    }
  } else {
    // No existing styled span found, create new one
    const span = document.createElement('span');
    span.className = [...new Set([
      className,
      ...frameworkUtilityClasses,
    ].filter(c => c))].join(' ');
    
    // Ensure CSS exists for this class
    span.className.split(/\s+/).filter(Boolean).forEach((classToken) => ensureClassCSS(classToken));
    
    // Use surroundContents for simpler, more reliable wrapping
    try {
      range.surroundContents(span);
    } catch (e) {
      // If surroundContents fails (e.g., partial text node), use alternative method
      // Extract contents, add to span, then insert the span
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
      
      // Restore selection to the span
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }    
    // Clean up unused CSS rules after any formatting change
    // Find the editor containing this span
    let editor = span;
    while (editor && editor.contentEditable !== 'true') {
      editor = editor.parentNode;
    }
    if (editor) cleanupUnusedCSS(editor);  }
};

/**
 * Insert a table
 */
export const insertTable = (rows = 2, cols = 2) => {
  let html = '<table style="border-collapse: collapse; border: 1px solid #ccc;"><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += '<td style="border: 1px solid #ccc; padding: 8px; min-width: 80px;">Cell</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  document.execCommand('insertHTML', false, html);
};

/**
 * Get active CSS classes from the currently selected span
 * Returns an object with detected styles like:
 * { bold: true, italic: false, size: 'size1', color: 'color2', font: 'font1', align: 'left' }
 */
export const getActiveStylesFromSelection = () => {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return {};

  const range = selection.getRangeAt(0);
  let commonNode = range.commonAncestorContainer;
  
  if (commonNode.nodeType === 3) {
    commonNode = commonNode.parentNode;
  }

  // Skip processing if inside a table cell - don't interfere with table editing
  let checkNode = commonNode;
  while (checkNode && checkNode !== document.body && checkNode !== document.documentElement) {
    if (checkNode.nodeName === 'TD' || checkNode.nodeName === 'TH') {
      return {}; // Inside table cell, return empty styles
    }
    checkNode = checkNode.parentNode;
  }

  // Find the styled span
  let targetSpan = null;
  let node = commonNode;
  
  const styleValues = ['bold', 'italic', 'underline', 'left', 'center', 'right', 'justify'];
  
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.nodeName === 'SPAN' && node.className) {
      const classes = node.className.split(/\s+/);
      if (classes.some(c => c.includes('-') || /^(color|font|size)\d+$/.test(c) || styleValues.includes(c))) {
        targetSpan = node;
        break;
      }
    }
    node = node.parentNode;
  }

  if (!targetSpan) return {};

  const className = targetSpan.className;
  const parts = className.split('-');
  const activeStyles = {};

  // Parse each part of the merged class
  for (const part of parts) {
    if (part === 'bold') activeStyles.bold = true;
    if (part === 'italic') activeStyles.italic = true;
    if (part === 'underline') activeStyles.underline = true;
    if (part === 'left') activeStyles.align = 'left';
    if (part === 'center') activeStyles.align = 'center';
    if (part === 'right') activeStyles.align = 'right';
    if (part === 'justify') activeStyles.align = 'justify';
    if (/^color\d+$/.test(part)) activeStyles.color = part;
    if (/^font\d+$/.test(part)) activeStyles.font = part;
    if (/^size\d+$/.test(part)) activeStyles.size = part;
  }

  return activeStyles;
};

/**
 * Get the actual CSS value for a class (e.g., "size1" -> "16px")
 * Returns null if not found
 */
export const getCSSValueForClass = (className) => {
  if (!className) return null;
  
  // Check stylesheet for the rule
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText === `.${className}`) {
            const style = rule.style;
            
            // Try to extract relevant value
            if (style.fontSize) return style.fontSize;
            if (style.color) return style.color;
            if (style.fontFamily) return style.fontFamily;
            
            return rule.cssText; // Return full rule as fallback
          }
        }
      } catch (e) {
        // Skip sheets we can't access
      }
    }
  } catch (e) {
    // Silently fail if accessing stylesheets fails
  }
  
  return null;
};

/**
 * Get current selection
 */
export const getSelection = () => {
  return window.getSelection();
};

/**
 * Get selected text
 */
export const getSelectedText = () => {
  return window.getSelection().toString();
};

/**
 * Check if text is selected
 */
export const hasSelection = () => {
  return window.getSelection().rangeCount > 0 && 
         window.getSelection().toString().length > 0;
};

/**
 * Focus editor element
 */
export const focusEditor = (editorElement) => {
  if (editorElement) {
    editorElement.focus();
  }
};

/**
 * Get editor content as HTML
 */
export const getEditorHTML = (editorElement) => {
  return editorElement?.innerHTML || '';
};

/**
 * Set editor content from HTML
 */
export const setEditorHTML = (editorElement, html) => {
  if (editorElement) {
    editorElement.innerHTML = sanitizeEditorHTML(html);
  }
};

/**
 * Clear editor content
 */
export const clearEditor = (editorElement) => {
  if (editorElement) {
    editorElement.innerHTML = '';
  }
};

/**
 * Set up keyboard shortcuts for common formatting
 */
export const setupKeyboardShortcuts = (editorElement, onShortcut) => {
  // Handle beforeinput event to prevent contentEditable default behavior
  const handleBeforeInput = (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key?.toLowerCase()) {
        case 'b':
        case 'i':
        case 'u':
          e.preventDefault();
          break;
        default:
          break;
      }
    }
  };

  const selectAllTextInEditor = () => {
    // Select all text nodes in the editor (mimics Ctrl+A naturally)
    const selection = window.getSelection();
    const range = document.createRange();
    
    // Find all text nodes using TreeWalker
    const walker = document.createTreeWalker(
      editorElement,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let firstTextNode = null;
    let lastTextNode = null;
    let node;
    while (node = walker.nextNode()) {
      // Skip empty/whitespace-only text nodes
      if (node.textContent.trim().length > 0) {
        if (!firstTextNode) firstTextNode = node;
        lastTextNode = node;
      }
    }
    
    if (firstTextNode && lastTextNode) {
      range.setStart(firstTextNode, 0);
      range.setEnd(lastTextNode, lastTextNode.textContent.length);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    
    return false;
  };

  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
        case 'i':
        case 'u':
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          const styleType = e.key.toLowerCase() === 'b' ? 'bold' : 
                           e.key.toLowerCase() === 'i' ? 'italic' : 'underline';
          
          // Apply the style with the current selection
          applyTextFormattingCSS(styleType);
          
          onShortcut?.(styleType);
          return false;
          
        default:
          break;
      }
    }
  };

  // Use capture phase to intercept before contentEditable default handlers
  editorElement?.addEventListener('keydown', handleKeyDown, true);
  editorElement?.addEventListener('beforeinput', handleBeforeInput, true);
  
  // Return cleanup function
  return () => {
    editorElement?.removeEventListener('keydown', handleKeyDown, true);
    editorElement?.removeEventListener('beforeinput', handleBeforeInput, true);
  };
};

/**
 * Insert snippet HTML at the current cursor position
 * Preserves existing content before and after the insertion point
 * @param {HTMLElement} editorElement - The contentEditable editor element
 * @param {string} snippetHtml - The snippet HTML to insert
 * @param {Function} restoreSelection - Optional callback to restore the saved editor range
 * @param {Range} savedRange - Optional range captured when the snippet modal opened
 */
export const insertSnippetAtCursor = (editorElement, snippetHtml, restoreSelection, savedRange) => {
  if (!editorElement || !snippetHtml) {
    console.warn('insertSnippetAtCursor: Missing editorElement or snippetHtml');
    return false;
  }

  try {
    const selection = window.getSelection();
    editorElement.focus();
    const restored = restoreSelection?.() === true;
    if (!restored && savedRange) {
      selection.removeAllRanges();
      selection.addRange(savedRange.cloneRange());
    }
    
    // If no selection, insert at the end
    if (!selection.rangeCount) {
      const range = document.createRange();
      range.selectNodeContents(editorElement);
      range.collapse(false); // Collapse to end
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const range = selection.getRangeAt(0);
    range.deleteContents(); // Remove selected text if any

    // Create a temporary container to hold the snippet HTML
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = sanitizeEditorHTML(snippetHtml);

    // Insert all nodes from the snippet
    let fragment = document.createDocumentFragment();
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild);
    }

    range.insertNode(fragment);

    // Move cursor to after the inserted content
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    // Trigger input event to notify parent component of change
    editorElement.dispatchEvent(new Event('input', { bubbles: true }));

    return true;
  } catch (error) {
    console.error('insertSnippetAtCursor error:', error);
    return false;
  }
};
