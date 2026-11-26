import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["ui/app/**/*.test.ts", "api/**/*.test.ts"],
    environment: "node",
    // @dynatrace-sdk packages mix ESM entry points with CommonJS dependencies.
    server: { deps: { inline: [/@dynatrace-sdk/] } },
  },
});
