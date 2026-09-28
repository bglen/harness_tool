import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@hs/model": r("./packages/model/src/index.ts"),
      "@hs/ui-tokens": r("./packages/ui-tokens/src/index.ts"),
      "@hs/dfm": r("./packages/dfm/src/index.ts"),
      "@hs/ops": r("./packages/ops/src/index.ts"),
      "@hs/io": r("./packages/io/src/index.ts"),
      "@hs/docs": r("./packages/docs/src/index.ts"),
      "@hs/providers": r("./packages/providers/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
  },
});
