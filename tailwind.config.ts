import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 4px 14px 0 rgba(0, 0, 0, 0.08)",
        "soft-lg": "0 10px 40px -10px rgba(0, 0, 0, 0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
