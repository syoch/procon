import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { MODE_IDS, type ModeId } from "../src/lib/mode_profiles";
import { pipelineScenario } from "./scenarios/pipeline";
import { splitScenario } from "./scenarios/split";
import { cacheReadScenario } from "./scenarios/cache-read";
import type { Scenario, ScenarioResult } from "./scenarios/types";
import { readFixtureStats } from "./lib/data";
import type { Samples } from "./lib/harness";
import { measureCalibration, type Calibration } from "./lib/reference";
import {
  SCHEMA_VERSION,
  type BenchReport,
  type Measurement,
  type ScenarioSummary,
} from "./lib/report";

// モードごとに測るシナリオはモードを渡して 1 個作る
const SCENARIOS: Scenario[] = [
  ...MODE_IDS.map((mode) => pipelineScenario(mode)),
  splitScenario,
  cacheReadScenario,
];

type Options = {
  /** 実行するシナリオ名（未指定なら全部） */
  only?: string;
  /** 実測回数 */
  iterations: number;
  /** 暖機回数 */
  warmup: number;
  /** 結果をこのパスに JSON で書き出す */
  json?: string;
  /** 出力を抑える（CI で bench だけ実行して比較に回すとき） */
  quiet: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { quiet: false, iterations: NaN, warmup: NaN };
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
  for (const name of ["iterations", "warmup"] as const) {
    const value = options[name];
    if (!(Number.isInteger(value) && value >= 0)) {
      throw new Error(`--${name} は 0 以上の整数で指定してください（必須の引数です）`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`使い方: pnpm bench --iterations <n> --warmup <n> [オプション]

  --iterations <n>      実測回数（必須）
  --warmup <n>          暖機回数（必須）
  --scenario <name>     実行するシナリオ (${scenarioNames().join(" / ")}、未指定なら全部)
  --json <path>         結果を JSON で書き出す（比較スクリプトが読む）
  --quiet               標準出力を抑える
  -h, --help            この表示

モードを使うシナリオは 1 回の実行で全モードを測る。
測定項目 ID はモードを使うシナリオでは {シナリオ}/{モード}/{段} になる。

例:
  pnpm bench --iterations 20 --warmup 5
  pnpm bench --iterations 30 --warmup 5 --scenario pipeline
  pnpm bench --iterations 20 --warmup 5 --json /tmp/bench.json --quiet

回帰チェックはここでは行わない。CI が「base と head を同じランナー上で 2 回測って比べる」
ので、compare.mjs に結果 JSON を渡して判定する。比較は測定項目 ID 単位で行う。

校正ワークロードは開始時と各シナリオの直前に測り、JSON の calibration と
scenarioCalibration に入れておく。compare.mjs がこれを比べることで「機械の速度が
変わった」だけの差を検出して、回帰と区別できる。`);
}

const ms = (value: number) => (Number.isNaN(value) ? "-" : `${value.toFixed(2)}ms`);

/**
 * 校正の測定結果を 1 行で出す。
 *
 * CI は 2 回の計測出力をそのまま `$GITHUB_STEP_SUMMARY` に貼るので、ここにも出しておくと
 * 「機械の速度が 2 回の間で変わっていないか」を成果物だけで判断できる。
 * `label` は「どの直前の校正か」を表す。シナリオ直前のものも 1 行ずつに落とす。
 */
function printCalibration(calibration: Calibration, label?: string) {
  const name = label === undefined ? "calibration" : `calibration [${label}]`;
  console.log(
    `${name}: ${ms(calibration.median)} ` +
      `(min=${ms(calibration.min)}, max=${ms(calibration.max)}, ${calibration.iterations} 回, ` +
      `work=${calibration.work})`,
  );
}

/** 段名は短いが ID は `{シナリオ}/{段}` なので 40 桁で揃える */
const ID_WIDTH = 40;

function printResult(result: ScenarioResult) {
  const label = result.mode === undefined ? result.scenario : `${result.scenario} [${result.mode}]`;
  console.log(`\n## ${label}`);
  if (result.info) {
    const info = Object.entries(result.info)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`  ${info}`);
  }
  // キーの型はシナリオごとに出ているが、表示は 1 つの表にまとめたい
  const rows = (Object.entries(result.stages) as [string, Samples][]).sort(
    (a, b) => b[1].median - a[1].median,
  );
  console.log(
    `  ${"id".padEnd(ID_WIDTH)}${"median".padStart(10)}${"min".padStart(10)}${"max".padStart(10)}`,
  );
  for (const [stage, samples] of rows) {
    const id = `${result.scenario}/${stage}`;
    console.log(
      `  ${id.padEnd(ID_WIDTH)}${ms(samples.median).padStart(10)}${ms(samples.min).padStart(10)}${ms(samples.max).padStart(10)}`,
    );
  }
  console.log(`  ${"total".padEnd(ID_WIDTH)}${ms(result.total).padStart(10)}`);
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
  const stats = readFixtureStats();
  if (!options.quiet) {
    const b = stats.boundary;
    console.log(
      `fixture: ${stats.cellCount} cells (${b.minLat},${b.minLng} - ${b.maxLat},${b.maxLng}) ` +
        `nodes=${stats.nodeCount} ways=${stats.wayCount} fetchedAt=${stats.fetchedAt}`,
    );
    console.log(`node: ${process.version} / iterations: ${options.iterations} / warmup: ${options.warmup}`);
  }

  const selected = options.only
    ? SCENARIOS.filter((s) => s.name === options.only)
    : SCENARIOS;
  if (selected.length === 0) {
    throw new Error(
      `シナリオが見つかりません: ${options.only} (候補: ${scenarioNames().join(", ")})`,
    );
  }

  const results: ScenarioResult[] = [];
  // 測定項目 ID をキーにした測定値の写像
  const measurements: Record<string, Measurement> = {};
  // 校正はシナリオより先に測る。フィクスチャを展開した直後でメモリが動いていると、
  // 校正がメモリを測ることになってしまうため、計測対象に触る前に済ませる。
  const calibration = await measureCalibration();
  if (!options.quiet) printCalibration(calibration);

  // シナリオの直前にも校正を測る。開始時の 1 回だけだと「計測の途中でランナーが遅くなった」
  // ことを検出できない。2026-10-02 の PR #100 では `pipeline` の `fold2DegreeEdges` が
  // min 50.10ms / median 76.91ms / max 157.93ms（base は min 34.97 / median 47.32 / max 62.59）で、
  // 最小値も中央値も上がり外れ値も大きくなっていたが、開始時の校正 1 回では語れなかった。
  const scenarioCalibration: Record<string, Calibration> = {};

  for (const scenario of selected) {
    const label = scenario.mode === undefined ? scenario.name : `${scenario.name} [${scenario.mode}]`;
    // 直前の校正を先に取る。シナリオの実行中はメモリが動きっぱなしなので、
    // シナリオの後に取ると校正がメモリを測ることになってしまう。
    // 校正はシナリオ単位で持つ（モードが違っても同じ仕事量を測るだけなので）。
    const before = await measureCalibration();
    scenarioCalibration[scenario.name] = before;
    if (!options.quiet) printCalibration(before, `${label} の直前`);

    const { value, log } = await withSummarizedOutput(() =>
      scenario.run({ iterations: options.iterations, warmup: options.warmup }),
    );
    results.push(value);
    // 測定項目の ID と測定値を平坦に並べる。CI が base と head を突き合わせるときの
    // 共有するのは「ID と測定値」だけで、JSON の他の構造には依存させない。
    for (const [stage, samples] of Object.entries(value.stages)) {
      measurements[stageId(value.scenario, value.mode, stage)] = samples;
    }
    if (!options.quiet && log.length > 0) {
      console.log(`\n  ${label} のログ:`);
      for (const line of log.slice(0, 10)) console.log(line);
      if (log.length > 10) console.log(`    ... 他 ${log.length - 10} 行`);
    }
  }

  for (const result of results) {
    if (!options.quiet) printResult(result);
  }

  if (options.json) {
    const payload: BenchReport = {
      schemaVersion: SCHEMA_VERSION,
      calibration,
      scenarioCalibration,
      measurements,
      // シナリオごとの補足（データ規模・合計時間）。比較には使わないので形式を固定しない。
      results: results.map(toScenarioSummary),
    };
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    if (!options.quiet) console.log(`\n wrote ${options.json}`);
  }
}

/** 測定項目 ID はモードを使うシナリオでは `{シナリオ}/{モード}/{段}` になる */
function stageId(scenario: string, mode: ModeId | undefined, stage: string): string {
  return mode === undefined ? `${scenario}/${stage}` : `${scenario}/${mode}/${stage}`;
}

/** シナリオ名の候補。重複したモードを 1 つにまとめる */
function scenarioNames(): string[] {
  return [...new Set(SCENARIOS.map((s) => s.name))];
}

function toScenarioSummary(result: ScenarioResult): ScenarioSummary {
  return {
    scenario: result.mode === undefined ? result.scenario : `${result.scenario}/${result.mode}`,
    total: result.total,
    ...(result.info === undefined ? {} : { info: result.info }),
  };
}

main().catch((error) => {
  // console を上書きしている可能性があるので、fd 2 に直接書く
  writeSync(2, `bench failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});