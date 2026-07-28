import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/tests/**/*.security.test.ts",
      "packages/**/tests/**/*.security.test.ts",
      "scripts/tests/**/*.security.test.ts",
    ],
  },
});
