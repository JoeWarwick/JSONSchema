/**
 * Color Palette Manager
 * Manages 7 core Tailwind colors + custom colors
 */

// 7 core Tailwind colors
export const CORE_COLORS = {
  red: '#ef4444',      // red-500
  blue: '#3b82f6',     // blue-500
  green: '#22c55e',    // green-500
  yellow: '#eab308',   // yellow-500
  purple: '#a855f7',   // purple-500
  pink: '#ec4899',     // pink-500
  gray: '#6b7280',     // gray-500
};

export const CORE_COLOR_NAMES = Object.keys(CORE_COLORS);

/**
 * Initialize custom colors from localStorage or empty array
 */
export const loadCustomColors = () => {
  try {
    const stored = localStorage.getItem('editor_custom_colors');
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load custom colors:', error);
    return [];
  }
};

/**
 * Save custom colors to localStorage
 */
export const saveCustomColors = (colors) => {
  try {
    localStorage.setItem('editor_custom_colors', JSON.stringify(colors));
  } catch (error) {
    console.error('Failed to save custom colors:', error);
  }
};

/**
 * Add a new custom color
 */
export const addCustomColor = (hex, customColors) => {
  const normalized = hex.startsWith('#') ? hex : `#${hex}`;
  // Check if color already exists
  if (customColors.includes(normalized)) {
    return customColors;
  }
  const updated = [...customColors, normalized];
  saveCustomColors(updated);
  return updated;
};

/**
 * Remove a custom color
 */
export const removeCustomColor = (hex, customColors) => {
  const updated = customColors.filter(color => color !== hex);
  saveCustomColors(updated);
  return updated;
};

/**
 * Get all available colors (core + custom)
 */
export const getAllColors = (customColors = []) => {
  return {
    core: CORE_COLORS,
    custom: customColors.reduce((acc, color, idx) => {
      acc[`custom-${idx}`] = color;
      return acc;
    }, {}),
  };
};

/**
 * Generate a class name for a color
 */
export const colorToClassName = (colorValue, customColors = []) => {
  // Check if it's a core color
  for (const [name, value] of Object.entries(CORE_COLORS)) {
    if (value === colorValue) {
      return `text-${name}-500`;
    }
  }
  // Check if it's a custom color
  const customIndex = customColors.indexOf(colorValue);
  if (customIndex !== -1) {
    return `text-custom-${customIndex}`;
  }
  return null;
};

/**
 * Validate hex color format
 */
export const isValidHexColor = (hex) => {
  return /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
};
