import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "trigger/index": "src/trigger/index.ts",
    "ai/index": "src/ai/index.ts",
    "ai/trigger": "src/ai/trigger.ts",
    "ai/workflow": "src/ai/workflow.ts",
    "workflow/index": "src/workflow/index.ts",
    "schemas/index": "src/schemas/index.ts",
  },
  format: ["esm"],
  dts: {
    resolve: true,
  },
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: ["@robotrock/core"],
  external: ["@opentelemetry/api", "@trigger.dev/sdk", "ai", "workflow"],
});
