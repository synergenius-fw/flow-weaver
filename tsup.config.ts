import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "api/index": "src/api/index.ts",
    "ast/index": "src/ast/index.ts",
    "runtime/index": "src/runtime/index.ts",
    "cli/index": "src/cli/index.ts",
    "jsdoc-port-sync": "src/jsdoc-port-sync.ts",
    "editor-completions/index": "src/editor-completions/index.ts",
    "diff/index": "src/diff/index.ts",
    "npm-packages": "src/npm-packages.ts",
    "deployment/index": "src/deployment/index.ts",
    "server/index": "src/server/index.ts",
    "plugin/index": "src/plugin/index.ts",
    "doc-metadata/index": "src/doc-metadata/index.ts",
    "cli/commands/describe": "src/cli/commands/describe.ts",
    "cli/commands/doctor": "src/cli/commands/doctor.ts",
    "marketplace/index": "src/marketplace/index.ts",
    "generated-branding": "src/generated-branding.ts",
  },
  format: ["cjs", "esm"],
  // Don't use tsup's dts - we use tsc separately to avoid .js extension issues
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
});
