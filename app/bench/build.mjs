/**
 * ベンチを 1 つのファイルにバンドルする。
 *
 * Vite や SvelteKit を通さない。ベンチはアプリと同じ TypeScript ソースを
 * `$lib` などのエイリアス付きで import する必要があるため、esbuild の
 * alias 解決をそのまま再現する。
 *
 * `$env/dynamic/private` は bench 側で差し替える（`env-stub.ts` を参照）。
 * 実際の環境変数ではなく bench 用の固定値を注入する。
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, "..");
const OUT_DIR = join(HERE, ".build");
const OUT_FILE = join(OUT_DIR, "bench.mjs");

await mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [join(HERE, "run.ts")],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // ベンチは測定対象なので、minify すると関数名が消えプロファイルが読めなくなる
  minify: false,
  sourcemap: true,
  logLevel: "warning",
  alias: {
    $lib: join(APP_DIR, "src", "lib"),
    "$env/dynamic/private": join(HERE, "env-stub.ts"),
  },
  define: {
    // 本番ビルドと同じ条件に揃える（dev ビルドだと assert などが残る）
    "import.meta.env.DEV": "false",
  },
  banner: {
    js: [
      "// 自動生成: app/bench/build.mjs が作成しています。直接編集しないでください。",
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log(`built ${OUT_FILE}`);
