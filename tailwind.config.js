/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
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
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        surface2: "rgb(var(--surface-2) / <alpha-value>)",
        line: "rgb(var(--border) / <alpha-value>)",
        ink1: "rgb(var(--text-1) / <alpha-value>)",
        ink2: "rgb(var(--text-2) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        accentHover: "rgb(var(--accent-hover) / <alpha-value>)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
