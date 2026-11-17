import { defineConfig } from "vitest/config";

// A separate Vitest config so tests do not load the app's Vite plugins.
// The data layer tests run in plain Node; `fake-indexeddb/auto` (imported by each test file)
// provides the IndexedDB globals that a browser would normally have.
export default defineConfig({
  test: {
    environment: "node",
    env: {
      TZ: "Europe/Istanbul",
    },
    include: ["src/**/*.test.ts"],
  },
});
