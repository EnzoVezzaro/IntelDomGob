import { defineConfig } from "vitest/config";

// Shared vitest config. The setup file loads the real .env into process.env so
// tests exercise actual configuration (DEFAULT_AI_API_KEY, etc.) instead of
// faking it. Default test discovery is unchanged; node:test-based suites still
// run under the node runner, not vitest.
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
