import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "app/src/**/*.test.{ts,tsx}",
      "evals/**/*.test.ts",
      "scripts/**/*.test.ts",
      "shared/src/**/*.test.ts",
    ],
  },
});
