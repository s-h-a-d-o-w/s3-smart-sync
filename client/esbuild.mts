import { build, Plugin } from "esbuild";

const failOnWarningPlugin: Plugin = {
  name: "fail-on-warning",
  setup(build) {
    build.onEnd((result) => {
      if (result.warnings.length > 0) {
        process.exit(1);
      }
    });
  },
};

await build({
  banner: {
    js: `import_meta_url = require("url").pathToFileURL(__filename).toString();`,
  },
  define: {
    "import.meta.url": "import_meta_url",
  },
  entryPoints: ["./src/index.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["*.node"],
  outfile: "./dist/index.cjs",
  plugins: [failOnWarningPlugin],
});
