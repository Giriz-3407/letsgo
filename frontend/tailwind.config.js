/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        canvas: '#09090b',
        surface: {
          DEFAULT: '#111114',
          subtle: '#16161b',
          elevated: '#1c1c22',
          hover: '#22222a',
        },
        border: {
          subtle: 'rgba(255, 255, 255, 0.07)',
          DEFAULT: 'rgba(255, 255, 255, 0.12)',
          strong: 'rgba(255, 255, 255, 0.20)',
        },
        brand: {
          50: '#f4f4f5',
          100: '#e4e4e7',
          500: '#ffffff',
          600: '#f4f4f5',
          700: '#d4d4d8',
          900: '#18181b',
        }
      }
    },
  },
  plugins: [],
}
