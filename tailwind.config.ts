import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07080c",
          900: "#0b0d14",
          800: "#11141f",
          700: "#1a1e2e",
        },
        glow: {
          DEFAULT: "#0ea5e9",
          soft: "#93c5fd",
          warm: "#ff7a59",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(14, 165, 233, 0.55)",
        card: "0 20px 60px -20px rgba(0, 0, 0, 0.8)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "pulse-glow": "pulse-glow 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
