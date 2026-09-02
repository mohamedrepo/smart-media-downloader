/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/popup/**/*.{html,ts,tsx}', './src/options/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f172a',
          raised: '#1e293b',
          overlay: '#334155',
        },
        accent: {
          DEFAULT: '#3b82f6',
          strong: '#2563eb',
        },
      },
    },
  },
  plugins: [],
};
