import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b1218",
        card: "#111e28",
        line: "#263947",
        txt: "#edf4f8",
        muted: "#a1b2c1",
        accent: "#6ddccf",
        futu: "#f59e0b",
        fable: "#a855f7",
        ok: "#22c55e",
        warn: "#f59e0b",
        bad: "#ef4444",
      },
    },
  },
  plugins: [],
};

export default config;
