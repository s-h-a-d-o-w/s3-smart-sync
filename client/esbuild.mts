import { build, type Plugin } from "esbuild";

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
    js: `
    import { createRequire } from 'node:module';
    import { dirname } from "node:path";
    const require = createRequire(import.meta.url);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
  `,
  },
  entryPoints: ["./src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["*.node"],
  outfile: "./dist/index.js",
  plugins: [failOnWarningPlugin],
});
