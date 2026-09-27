import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#ff5252", dark: "#e03e3e" },
      },
    },
  },
  plugins: [],
};

export default config;
