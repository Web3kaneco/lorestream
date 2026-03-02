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
        },
        keyframes: {
          'hint-float': {
            '0%, 100%': { transform: 'translateY(0px)', opacity: '0.8' },
            '50%': { transform: 'translateY(-4px)', opacity: '1' },
          },
        },
      },
    },
    plugins: [],
  }