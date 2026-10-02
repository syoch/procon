import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import { inspect } from "node:util";
import { dirname } from "node:path";

import { pipelineScenario } from "./scenarios/pipeline";
import { splitScenario } from "./scenarios/split";
import { cacheReadScenario } from "./scenarios/cache-read";
import type { Scenario, ScenarioResult } from "./scenarios/types";
import { readFixtureMeta } from "./lib/data";


const SCENARIOS: Scenario[] = [pipelineScenario, splitScenario, cacheReadScenario];

type Options = {
  /** 実行するシナリオ名（未指定なら全部） */
  only?: string;
  /** 実測回数 */
  iterations?: number;
  /** 暖機回数 */
  warmup?: number;
  /** 移動モード */
  mode: string;
  /** 結果をこのパスに JSON で書き出す */
  json?: string;
  /** 出力を抑える（CI で bench だけ実行して比較に回すとき） */
  quiet: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { mode: "car", quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--scenario":
        options.only = next();
        break;
      case "--iterations":
        options.iterations = Number(next());
        break;
      case "--warmup":
        options.warmup = Number(next());
        break;
      case "--mode":
        options.mode = next();
        break;
      case "--json":
        options.json = next();
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`不明な引数: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`使い方: pnpm bench [オプション]

  --scenario <name>     実行するシナリオ (${SCENARIOS.map((s) => s.name).join(" / ")}、未指定なら全部)
  --iterations <n>      実測回数 (既定は各シナリオの defaultIterations)
  --warmup <n>          暖機回数 (既定 5)
  --mode <id>           移動モード (既定 car)
  --json <path>         結果を JSON で書き出す（比較スクリプトが読む）
  --quiet               標準出力を抑える
  -h, --help            この表示

例:
  pnpm bench
  pnpm bench --scenario pipeline --iterations 30
  pnpm bench --json /tmp/bench.json --quiet

回帰チェックはここでは行わない。CI が「base と head を同じランナー上で 2 回測って比べる」
ので、compare.mjs に結果 JSON を渡して判定する。machine ごとに違う値をリポジトリに
保存しないため、記録用の基準ファイルは要らない。`);
}

const ms = (value: number) => (Number.isNaN(value) ? "-" : `${value.toFixed(2)}ms`);

function printResult(result: ScenarioResult) {
  console.log(`\n## ${result.scenario}`);
  if (result.info) {
    const info = Object.entries(result.info)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`  ${info}`);
  }
  const rows = Object.entries(result.stages).sort((a, b) => b[1].median - a[1].median);
  const total = rows.reduce((sum, [, s]) => sum + s.median, 0);
  console.log(`  ${"stage".padEnd(32)}${"median".padStart(10)}${"min".padStart(10)}${"max".padStart(10)}`);
  for (const [stage, samples] of rows) {
    console.log(
      `  ${stage.padEnd(32)}${ms(samples.median).padStart(10)}${ms(samples.min).padStart(10)}${ms(samples.max).padStart(10)}`,
    );
  }
  console.log(`  ${"total".padEnd(32)}${ms(total).padStart(10)}`);
}


/**
 * 計測中に出る出力を要約する。
 *
 * `transientSplit` はフィクスチャ内の長さゼロの way ごとに
 * 「エッジの長さがゼロです」を出すので、そのまま放置すると出力が埋まる。
 *
 * `console` のメソッドを差すだけでは取りこぼすので、`process.stdout.write` /
 * `process.stderr.write` 自体を差して全部回収し、同じ内容は回数だけまとめる。
 * 想定外の出力も消さずに summary として出す。
 */
function withSummarizedOutput<T>(fn: () => T | Promise<T>): { value: T; log: string[] } | Promise<{ value: T; log: string[] }> {
  const counts = new Map<string, number>();
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const collect = (chunk: unknown) => {
    const text = typeof chunk === "string" ? chunk : String(chunk);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return true;
  };

  process.stdout.write = collect as typeof process.stdout.write;
  process.stderr.write = collect as typeof process.stderr.write;

  const finish = (value: T) => {
    process.stdout.write = originalStdout as typeof process.stdout.write;
    process.stderr.write = originalStderr as typeof process.stderr.write;
    const log: string[] = [];
    for (const [line, count] of counts) {
      log.push(count === 1 ? `    ${line}` : `    ${line} (x${count})`);
    }
    return { value, log };
  };

  let result: T;
  try {
    result = fn() as T;
  } catch (error) {
    finish(undefined as T);
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value) => finish(value),
      (error) => {
        finish(undefined as T);
        throw error;
      },
    );
  }
  return finish(result);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const meta = readFixtureMeta();
  if (!options.quiet) {
    console.log(`fixture: ${meta.name} (${meta.cellCount} cells, nodes=${meta.nodeCount}, ways=${meta.wayCount})`);
    console.log(`node: ${process.version} / mode: ${options.mode}`);
  }

  const selected = options.only
    ? SCENARIOS.filter((s) => s.name === options.only)
    : SCENARIOS;
  if (selected.length === 0) {
    throw new Error(
      `シナリオが見つかりません: ${options.only} (候補: ${SCENARIOS.map((s) => s.name).join(", ")})`,
    );
  }

  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    const { value, log } = await withSummarizedOutput(() =>
      scenario.run({
        mode: options.mode,
        iterations: options.iterations ?? scenario.defaultIterations,
        warmup: options.warmup ?? 5,
      }),
    );
    results.push(value);
    if (!options.quiet && log.length > 0) {
      console.log(`\n  ${scenario.name} のログ:`);
      for (const line of log.slice(0, 10)) console.log(line);
      if (log.length > 10) console.log(`    ... 他 ${log.length - 10} 行`);
    }
  }

  for (const result of results) {
    if (!options.quiet) printResult(result);
  }

  if (options.json) {
    const payload = {
      node: process.version,
      mode: options.mode,
      fixture: readFixtureMeta(),
      results,
    };
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    if (!options.quiet) console.log(`\n wrote ${options.json}`);
  }
}

main().catch((error) => {
  // console を上書きしている可能性があるので、fd 2 に直接書く
  writeSync(2, `bench failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
