/**
 * bench を短時間で N 回走らせて、校正と段それぞれのばらつきを採取する。
 *
 * CI は「同じランナー・同じフィクスチャ・同じコード」を 2 回測って比べるので、
 * このスクリプトが測りたいのは「同じコードを 2 回測ったときの差がどれくらい動くか」。
 * 許容倍率（`--tolerance`、既定 1.5）と校正の許容（`--calibration-tolerance`、既定 0.10）は
 * この数字を根拠に決めたものなので、数字の根拠そのものを出し直せるようにしておく。
 *
 * 使い方:
 *   node bench/scripts/measure-noise.mjs --iterations 20 --warmup 5 [--runs 7] [--scenario pipeline]
 *   node bench/scripts/measure-noise.mjs --json /tmp/noise.json
 *
 * 先に `node bench/build.mjs` を実行しておく必要がある（バンドル済みの成果物を使う）。
 * 計測そのものは bench 側の `bench/.build/bench.mjs` を子プロセスとして呼び、
 * `--json` で吐かれた結果を 1 回 1 ファイルとして集める。bench をこのスクリプトに
 * 取り込むと「計測対象を計測するコード」同士が混ざるので、必ず別プロセスで走らせる。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBenchReport } from "../lib/report.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = join(HERE, "..");
const APP_DIR = join(BENCH_DIR, "..");
const BUNDLE = join(BENCH_DIR, ".build", "bench.mjs");

const OPTIONS = {
  runs: 7,
  iterations: NaN,
  warmup: NaN,
  scenario: undefined,
  minMs: 0.5,
  tolerance: 1.5,
  calibrationTolerance: 0.1,
  json: undefined,
};

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--help" || key === "-h") {
      printUsage();
      process.exit(0);
    }
    const value = argv[++i];
    if (key === "--runs") OPTIONS.runs = Number(value);
    else if (key === "--iterations") OPTIONS.iterations = Number(value);
    else if (key === "--warmup") OPTIONS.warmup = Number(value);
    else if (key === "--scenario") OPTIONS.scenario = value;
    else if (key === "--min-ms") OPTIONS.minMs = Number(value);
    else if (key === "--tolerance") OPTIONS.tolerance = Number(value);
    else if (key === "--calibration-tolerance") OPTIONS.calibrationTolerance = Number(value);
    else if (key === "--json") OPTIONS.json = value;
    else throw new Error(`不明な引数: ${key}`);
  }
  if (!(OPTIONS.runs >= 2)) throw new Error(`--runs は 2 以上にしてください: ${OPTIONS.runs}`);
  for (const name of ["iterations", "warmup"]) {
    const value = OPTIONS[name];
    if (!(Number.isInteger(value) && value >= 0)) {
      throw new Error(`--${name} は 0 以上の整数で指定してください（必須の引数です）`);
    }
  }
}

function printUsage() {
  console.log(`使い方: node bench/scripts/measure-noise.mjs [オプション]

  --iterations <n>            bench 側の実測回数 (必須)
  --warmup <n>                bench 側の暖機回数 (必須)
  --runs <n>                  走らせる回数 (既定 7。1 回 8 秒程度)
  --scenario <name>           シナリオを 1 つだけ測る (pipeline / split / cache-read)
  --tolerance <x>             段の許容倍率 (既定 1.5。compare.mjs と同じ)
  --calibration-tolerance <t> 校正の許容 (既定 0.10。compare.mjs と同じ)
  --min-ms <ms>                ノイズ床。表の「対象」表示に使う (既定 0.5)
  --json <path>               採取した生データを JSON で保存する

先に "node bench/build.mjs" を実行しておく必要がある。校正は bench 自身が測るので、
ここで別に測り直さない（同じコードからは同じ数字が出るため）。`);
}

const ms = (value) => `${value.toFixed(2)}ms`;
const x2 = (value) => `${value.toFixed(2)}x`;

/** 校正 1 件の測定値（開始時の校正と、シナリオ直前の校正を同じ形にする） */
function calibrationSamples(parsed) {
  const samples = [{ key: "calibration（開始時）", value: parsed.calibration.median }];
  for (const [name, calibration] of Object.entries(parsed.scenarioCalibration)) {
    samples.push({ key: `calibration（${name} の直前）`, value: calibration.median });
  }
  return samples;
}

/** 段の測定値を測定項目 ID で集める（bench/compare.mjs と同じ取り出し方を使う） */
function stageSamples(parsed) {
  return Object.entries(parsed.measurements).map(([id, item]) => ({ key: id, value: item.median }));
}

function runBench(outputPath) {
  const args = [
    BUNDLE,
    "--quiet",
    "--json",
    outputPath,
    "--iterations",
    String(OPTIONS.iterations),
    "--warmup",
    String(OPTIONS.warmup),
  ];
  if (OPTIONS.scenario !== undefined) args.push("--scenario", OPTIONS.scenario);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: APP_DIR,
    encoding: "utf-8",
    // bench は計測対象なので出力を捨てる。異常終了のときだけ見えるようにする
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `bench が失敗しました (exit=${result.status})\n${result.stderr ?? ""}\n${result.stdout ?? ""}`,
    );
  }
  return {
    elapsedMs: Date.now() - started,
    report: JSON.parse(readFileSync(outputPath, "utf-8")),
  };
}

/** 1 つの指標について、ばらつきを表す数字をまとめる */
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const first = values[0];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd =
    values.length > 1
      ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1))
      : 0;
  // CI がやるのは「連続する 2 回の比」。先頭回との比よりこれのほうが近い
  const consecutive = values.slice(1).map((v, i) => v / values[i]);
  return {
    n: values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    cv: mean === 0 ? 0 : sd / mean,
    firstRatio: values.map((v) => v / first),
    consecutive,
    // 最も組の悪い 2 回を選んだときの比。これが「誤検出されうる最大倍率」の上限
    worstPair: sorted[sorted.length - 1] / sorted[0],
  };
}

function range(values) {
  return `${x2(Math.min(...values))} - ${x2(Math.max(...values))}`;
}

function main() {
  parseArgs(process.argv.slice(2));
  if (!existsSync(BUNDLE)) {
    throw new Error(`${BUNDLE} がありません。先に "node bench/build.mjs" を実行してください`);
  }

  const workDir = mkdtempSync(join(tmpdir(), "bench-noise-"));
  const calibration = new Map();
  const stages = new Map();
  const nodes = [];
  const elapsed = [];
  try {
    for (let i = 0; i < OPTIONS.runs; i++) {
      const outputPath = join(workDir, `bench-${i}.json`);
      const { report, elapsedMs } = runBench(outputPath);
      // 結果 JSON の取り出しは compare.mjs と同じ検証を通す
      const parsed = parseBenchReport(report);
      nodes.push(process.version);
      elapsed.push(elapsedMs);
      for (const { key, value } of calibrationSamples(parsed)) {
        if (!Number.isFinite(value)) throw new Error(`校正の測定値が不正です: ${key}`);
        const list = calibration.get(key) ?? [];
        list.push(value);
        calibration.set(key, list);
      }
      for (const { key, value } of stageSamples(parsed)) {
        const list = stages.get(key) ?? [];
        list.push(value);
        stages.set(key, list);
      }
      process.stdout.write(`  ${i + 1} 回を実行しました (${(elapsedMs / 1000).toFixed(1)} 秒)\n`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (OPTIONS.json !== undefined) {
    writeFileSync(
      OPTIONS.json,
      `${JSON.stringify(
        {
          node: nodes[0],
          runs: OPTIONS.runs,
          calibration: Object.fromEntries(calibration),
          stages: Object.fromEntries(stages),
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  }

  const calibrationRows = [...calibration].map(([key, values]) => [key, summarize(values)]);
  const stageRows = [...stages]
    .map(([key, values]) => [key, summarize(values)])
    .sort((a, b) => b[1].worstPair - a[1].worstPair);

  console.log("\n## 採取した環境");
  console.log(`  node: ${nodes[0]}`);
  console.log(
    `  ${OPTIONS.runs} 回を採取。1 回あたり平均 ${(
      elapsed.reduce((a, b) => a + b, 0) / elapsed.length / 1000
    ).toFixed(1)} 秒、合計 ${(elapsed.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} 秒`,
  );
  console.log(
    `  段の許容 ${OPTIONS.tolerance}x / 校正の許容 1±${OPTIONS.calibrationTolerance} / ノイズ床 ${OPTIONS.minMs}ms`,
  );

  console.log("\n## 校正（機械そのもの）");
  console.log(`  ${"指標".padEnd(40)}${"中央値".padStart(9)}${"先頭回比".padStart(18)}${"連続比".padStart(18)}${"最悪の組".padStart(10)}${"CV".padStart(8)}`);
  for (const [key, stats] of calibrationRows) {
    const over = stats.firstRatio.filter((r) => Math.abs(r - 1) > OPTIONS.calibrationTolerance).length;
    console.log(
      `  ${key.padEnd(40)}${ms(stats.median).padStart(9)}${range(stats.firstRatio).padStart(18)}` +
        `${range(stats.consecutive).padStart(18)}${x2(stats.worstPair).padStart(10)}` +
        `${`${(stats.cv * 100).toFixed(1)}%`.padStart(8)}  許容外 ${over}/${stats.n}`,
    );
  }

  console.log("\n## 段（同じコードを N 回測ったときのばらつき）");
  console.log(`  ${"指標".padEnd(40)}${"中央値".padStart(9)}${"先頭回比".padStart(18)}${"連続比".padStart(18)}${"最悪の組".padStart(10)}${"CV".padStart(8)}`);
  for (const [key, stats] of stageRows) {
    const median = stats.median;
    const target = median >= OPTIONS.minMs;
    const over = stats.firstRatio.filter((r) => r > OPTIONS.tolerance).length;
    console.log(
      `  ${key.padEnd(40)}${ms(median).padStart(9)}${range(stats.firstRatio).padStart(18)}` +
        `${range(stats.consecutive).padStart(18)}${x2(stats.worstPair).padStart(10)}` +
        `${`${(stats.cv * 100).toFixed(1)}%`.padStart(8)}  ${target ? "対象" : "床"} 許容超 ${over}/${stats.n}`,
    );
  }

  // 判断の材料になる数字だけを最後にまとめる。この 4 行が判断の根拠になる
  // CI が比べるのは「続けて走らせた 2 回」なので、採取中のドリフトではなく連続比で見る
  const calPairs = calibrationRows.flatMap(([, s]) => s.consecutive);
  const calOverCount = calPairs.filter((r) => Math.abs(r - 1) > OPTIONS.calibrationTolerance).length;
  const gated = stageRows.filter(([, s]) => s.median >= OPTIONS.minMs);
  const gatedPairs = gated.flatMap(([, s]) => s.consecutive);
  const worstStageKey = gatedPairs.reduce(
    (worst, ratio) => {
      const [key] = gated.find(([, s]) => s.consecutive.includes(ratio));
      return ratio > worst.ratio ? { key, ratio } : worst;
    },
    { key: "-", ratio: 0 },
  );
  const stageOverCount = gatedPairs.filter((r) => r > OPTIONS.tolerance).length;
  // 採取の途中でランナーの状態が変わると、そのセッションの数字は全部疑わしくなる
  const startCalibration = calibrationRows[0][1];
  const drift = Math.max(...startCalibration.firstRatio) / Math.min(...startCalibration.firstRatio);
  const worstStage = gated.length > 0 ? Math.max(...gated.map(([, s]) => s.worstPair)) : 0;

  console.log("\n## 判断の材料");
  console.log(
    `  CI は base と head を同じランナー上で続けて 2 回走らせるので、読めるのは連続する 2 回の比。`,
  );
  console.log(
    `  校正の連続比は ${range(calPairs)}。許容 1±${OPTIONS.calibrationTolerance} を超えたのは ` +
      `${calOverCount}/${calPairs.length} 組。`,
  );
  console.log(
    `  判定対象の段の連続比は ${range(gatedPairs)}（最もずれた段は ${worstStageKey.key}）。` +
      ` 許容 ${OPTIONS.tolerance}x を超えたのは ${stageOverCount}/${gatedPairs.length} 組。`,
  );
  console.log(
    `  採取中のドリフト（開始時の校正の最大/最小）は ${x2(drift)}。` +
      ` 1.1x を超えていたら、このセッションの数字より採取中の负荷の変化を疑うこと。`,
  );
  console.log(
    `  参考: 判定対象の段の最悪の組（採取中のどの 2 回でも選んだときの上限）は ${x2(worstStage)}。`,
  );
}

main();