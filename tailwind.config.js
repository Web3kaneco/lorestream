/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./app/**/*.{js,ts,jsx,tsx,mdx}",
      "./components/**/*.{js,ts,jsx,tsx,mdx}"
    ],
    theme: {
      extend: {
        animation: {
          'hint-float': 'hint-float 2.5s ease-in-out infinite',
          'float-in': 'floatIn 0.35s ease-out forwards',
        },
        keyframes: {
          'hint-float': {
            '0%, 100%': { transform: 'translateY(0px)', opacity: '0.8' },
            '50%': { transform: 'translateY(-4px)', opacity: '1' },
          },
          floatIn: {
            '0%': { opacity: '0', transform: 'scale(0.85) translateY(16px)' },
            '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
          },
        },
      },
    },
    plugins: [],
  }