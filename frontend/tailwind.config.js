/** @type {import('tailwindcss').Config} */
// CareSphere design tokens. Brand colours come from the logo: navy #1B2A6B and blue #1D5FD6.
// Existing class names (navy-900, brand, brand-dark, brand-soft, page) are kept, so every page picks up
// the new palette without being rewritten.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#121D4D',
          900: '#1B2A6B', // primary navy (logo)
          800: '#24357F',
          700: '#33458F',
          600: '#4A5BA3',
        },
        brand: {
          DEFAULT: '#1D5FD6', // primary blue (logo), 5.9:1 on white
          dark: '#174BAA',
          soft: '#EEF4FD',
          50: '#F4F8FE',
          100: '#E3ECFB',
          200: '#C6D8F7',
          300: '#9DBCF0',
          400: '#7FA8F0', // accessible blue on navy backgrounds (5.0:1 on #1B2A6B)
          600: '#1D5FD6',
          700: '#174BAA',
          800: '#143F8C',
        },
        page: '#F5F7FB',
        // Secondary text: a slightly darker slate-500 so small grey text meets WCAG AA (5:1) on white and on page.
        slate: { 500: '#5B6B82' },
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 42, 107, 0.06), 0 1px 3px rgba(27, 42, 107, 0.05)',
        lift: '0 4px 14px -4px rgba(27, 42, 107, 0.18)',
        modal: '0 20px 50px -12px rgba(18, 29, 77, 0.35)',
      },
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
