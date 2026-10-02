// Builds the client bundle the way the Paseo daemon does (packages/server/src/server/plugins/compiler.ts
// in getpaseo/paseo) and parses it with the Hermes compiler shipped in react-native. Plugin bundles skip
// Metro, so syntax Hermes cannot evaluate (e.g. `class`) only fails on mobile:
// https://github.com/getpaseo/paseo/issues/5783
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, process.argv[2] ?? "index.client.tsx");

const require = createRequire(join(root, "package.json"));
const binDir = { darwin: "osx-bin", linux: "linux64-bin", win32: "win64-bin" }[process.platform];
const hermesc = join(
  dirname(require.resolve("react-native/package.json")),
  "sdks",
  "hermesc",
  binDir ?? "",
  process.platform === "win32" ? "hermesc.exe" : "hermesc",
);
if (!binDir || !existsSync(hermesc)) {
  console.error(`No Hermes compiler for ${process.platform} at ${hermesc}`);
  process.exit(1);
}

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "cjs",
  jsx: "automatic",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  supported: { "async-await": false },
  external: ["@getpaseo/plugin", "@getpaseo/plugin/*", "@tanstack/react-query", "react", "react/jsx-runtime", "react-native", "zod"],
  logLevel: "silent",
  write: false,
});
const code = result.outputFiles[0].text.replaceAll("get: () => from[key]", "value: from[key]");
const bundle = `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;

const dir = mkdtempSync(join(tmpdir(), "paseo-plugin-hermes-"));
try {
  const file = join(dir, "client-bundle.js");
  writeFileSync(file, bundle);
  execFileSync(hermesc, ["-emit-binary", "-out", join(dir, "client-bundle.hbc"), file], { stdio: "pipe" });
  console.log(`Hermes accepts the client bundle (${relative(root, entry)})`);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
