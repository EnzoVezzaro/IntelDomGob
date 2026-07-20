export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(220 13% 20%)",
        background: "hsl(222 47% 8%)",
        surface: "hsl(222 40% 11%)",
        foreground: "hsl(210 40% 96%)",
        muted: "hsl(215 20% 60%)",
        primary: "hsl(199 89% 48%)",
        danger: "hsl(0 72% 51%)",
        ok: "hsl(142 71% 45%)",
        warn: "hsl(38 92% 50%)",
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
