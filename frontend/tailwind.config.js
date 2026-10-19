/** @type {import('tailwindcss').Config} */
// CareSphere design tokens. Colours are CSS variables (src/styles/tokens.css) so light, dark and high-contrast themes
// switch without changing class names; the per-property maps come from src/theme/palette.js. Brand: navy #1B2A6B
// and blue #1D5FD6 (logo), interface blue #1B5FD1.
import { backgroundColor, borderColor, colors, placeholderColor, ringColor, textColor } from './src/theme/palette.js';

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors,
      textColor,
      backgroundColor,
      borderColor,
      ringColor,
      placeholderColor,
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        card: 'var(--cs-shadow)',
        lift: 'var(--cs-shadow-hover)',
        modal: '0 20px 50px -12px rgba(18, 29, 77, 0.35)',
      },
      // Keyboard focus: every ring-2 focus indicator is 3px (WCAG 2.2 focus appearance), 4px in high contrast.
      ringWidth: { 2: 'var(--cs-focus-width)' },
      keyframes: {
        'cs-fade': { from: { opacity: '0' }, to: { opacity: '1' } },
        'cs-pop': { from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'cs-slide-down': { from: { opacity: '0', transform: 'translateY(-4px)' }, to: { opacity: '1', transform: 'none' } },
        'cs-toast': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'cs-shimmer': { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: {
        fade: 'cs-fade 150ms ease-out',
        pop: 'cs-pop 180ms ease-out',
        'slide-down': 'cs-slide-down 150ms ease-out',
        toast: 'cs-toast 200ms ease-out',
        shimmer: 'cs-shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};
