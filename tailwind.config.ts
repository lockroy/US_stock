import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0d1117",
        card: "#161b22",
        line: "#30363d",
        txt: "#e6edf3",
        muted: "#8b949e",
        accent: "#3b82f6",
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
