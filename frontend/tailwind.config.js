/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 900: '#0F172A', 800: '#1E293B', 700: '#334155' },
        brand: { DEFAULT: '#2563EB', dark: '#1D4ED8', soft: '#EFF6FF' },
        page: '#F1F5F9',
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
        modal: '0 20px 50px -12px rgba(15, 23, 42, 0.35)',
      },
    },
  },
  plugins: [],
};
