import type { Config } from "tailwindcss";
import { tailwindColors } from "../../packages/ui-tokens/src/index";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: tailwindColors,
      fontFamily: { ui: ["var(--font-ui)"], mono: ["var(--font-mono)"] },
      fontSize: { "2xs": ["11px", "16px"], xs: ["12px", "16px"], sm: ["13px", "18px"], base: ["14px", "20px"], md: ["16px", "22px"], lg: ["20px", "26px"], xl: ["24px", "30px"] },
      borderRadius: { control: "6px", card: "8px", chip: "4px" },
      transitionDuration: { fast: "120ms", med: "180ms" },
    },
  },
  plugins: [],
} satisfies Config;
