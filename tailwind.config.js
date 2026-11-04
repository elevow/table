/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        // A cool, low-contrast neutral: dark surfaces step up gently instead of jumping
        gray: {
          50: '#f7f8fa',
          100: '#eef0f3',
          200: '#dde1e7',
          300: '#bcc3cd',
          400: '#8d96a5',
          500: '#636d7d',
          600: '#3c4553',
          700: '#262d38',
          800: '#171c24',
          900: '#0e1218',
          950: '#090c10',
        },
        // Table felt and rail
        felt: {
          light: '#1f7a55',
          DEFAULT: '#145c40',
          dark: '#0b3b29',
          rail: '#1a1410',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.25), 0 8px 24px -12px rgba(0,0,0,0.45)',
        playing: '0 1px 1px rgba(0,0,0,0.25), 0 4px 10px -2px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
}
