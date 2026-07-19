import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    include: ["app/src/**/*.test.{ts,tsx}", "shared/src/**/*.test.ts"],
  },
});
