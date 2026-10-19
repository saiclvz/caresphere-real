/**
 * CareSphere colour palette for Tailwind. Every colour that changes with the theme points at a CSS variable from
 * src/styles/tokens.css (light, dark and high-contrast values live there), so pages keep their existing class
 * names and still follow the theme.
 *
 * Some class names are used in two roles: `text-navy-900` is heading text, `bg-navy-900` is a navy brand surface;
 * `bg-white` is a card, `text-white` is text on a coloured button. Tailwind lets each property have its own
 * colours, so the per-property maps below give each role its own token. Imported by tailwind.config.js.
 */
const v = (name) => `rgb(var(--cs-${name}) / <alpha-value>)`;

/** Default for every colour utility (background, border, ring, divide...) unless a per-property map overrides it. */
export const colors = {
  page: v('page'),
  navy: { 600: v('navy-600'), 700: v('navy-700'), 800: v('navy-800'), 900: v('navy-900'), 950: v('navy-950') },
  brand: {
    DEFAULT: v('primary'), dark: v('primary-hover'), soft: v('tint-1'),
    50: v('tint-1'), 100: v('tint-2'), 200: v('tint-3'), 300: v('brand-300'), 400: v('brand-400'),
    600: v('primary'), 700: v('primary-hover'), 800: v('primary-active'),
  },
  slate: {
    50: v('surface-2'), 100: v('surface-3'), 200: v('line'), 300: v('line-strong'), 400: v('faint'),
    500: v('muted'), 600: v('body-2'), 700: v('body'), 800: v('body'), 900: v('heading'), 950: v('heading'),
  },
  // Status colours: tints (50-100), outlines (200-300), solid accents (400-500, fixed), text (600-950).
  emerald: { 50: v('success-bg'), 100: v('success-bg-2'), 200: v('success-line'), 300: '#6EE7B7', 400: '#34D399', 500: '#10B981', 600: v('success-text'), 700: v('success-text'), 800: v('success-text'), 900: v('success-text'), 950: v('success-text') },
  amber: { 50: v('warning-bg'), 100: v('warning-bg-2'), 200: v('warning-line'), 300: v('warning-line'), 400: '#FBBF24', 500: '#F59E0B', 600: v('warning-text'), 700: v('warning-text'), 800: v('warning-text'), 900: v('warning-text'), 950: v('warning-text') },
  red: { 50: v('danger-bg'), 100: v('danger-bg-2'), 200: v('danger-line'), 300: v('danger-line'), 400: '#F87171', 500: '#EF4444', 600: v('danger-text'), 700: v('danger-text'), 800: v('danger-text'), 900: v('danger-text'), 950: v('danger-text') },
  blue: { 50: v('info-bg'), 100: v('info-bg'), 200: v('info-line'), 300: v('info-line'), 400: '#60A5FA', 500: '#3B82F6', 600: v('info-text'), 700: v('info-text'), 800: v('info-text'), 900: v('info-text') },
};

/** Text: navy is heading text; white stays white (text on coloured buttons and navy panels). */
export const textColor = {
  navy: { 600: v('heading-2'), 700: v('heading-2'), 800: v('heading-2'), 900: v('heading'), 950: v('heading') },
  brand: { DEFAULT: v('link'), 300: '#9DBCF0', 400: '#7FA8F0', 600: v('link'), 700: v('link-strong'), 800: v('link-strong') },
  slate: { 200: '#E2E8F0', 300: v('disabled') },
};

/** Backgrounds: white is the card / input surface; solid status fills used behind white text stay fixed. */
export const backgroundColor = {
  white: v('surface'),
  red: { 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B' },
  emerald: { 600: '#0B6B3A', 700: '#095A31' },
};

/** Borders: slate-100/200 are decorative card lines; slate-300/400 outline form controls (3:1). */
export const borderColor = {
  slate: { 50: v('line'), 100: v('line'), 200: v('line'), 300: v('control'), 400: v('control') },
  brand: { DEFAULT: v('primary'), 200: v('tint-3'), 300: v('brand-300') },
  red: { 400: '#EF4444', 500: '#EF4444', 600: '#DC2626' },
};

/** Focus rings use the focus token. */
export const ringColor = { brand: { DEFAULT: v('focus'), 300: '#9DBCF0' } };

export const placeholderColor = { slate: { 400: v('placeholder'), 500: v('placeholder') } };
