import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    // Next.js enforces this marker at build time; tests run server modules directly.
    "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
  } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
