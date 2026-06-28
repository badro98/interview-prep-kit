/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        ink: {
          900: "#0b0c0f",
          800: "#121419",
          700: "#1a1d24",
          600: "#242833",
          500: "#363b49",
        },
        accent: {
          500: "#6366f1",
          400: "#818cf8",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
