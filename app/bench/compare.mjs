/**
 * 2 つの bench 結果 JSON を比べる。
 *
 * 使い方:
 *   node bench/compare.mjs --base base.json --head head.json [--tolerance 1.5]
 *   node bench/compare.mjs --base base.json --head head.json --format markdown
 *
 * なぜ base と head を 2 回測るか:
 * 記録用の基準ファイルをリポジトリに持つと、CPU も Node も違うランナーで
 * 取得した値が混ざり、PR 同士で基準ファイルが衝突する。CI 上で同じランナー・
 * 同じフィクスチャで 2 回測って比べるなら、差分はそのまま PR の変更による
 * ものとして読める。
 *
 * exit code:
 *   0  許容倍率以内（改善も含む）
 *   1  許容倍率を超えた段がある（回帰）
 *   2  比較そのものが成立しない（フィクスチャや Node が違う / 入力が不正）
 */
import { readFileSync } from "node:fs";

const OPTIONS = { tolerance: 1.5, format: "text", minMs: 0.5 };

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[++i];
    if (key === "--base") OPTIONS.base = value;
    else if (key === "--head") OPTIONS.head = value;
    else if (key === "--tolerance") OPTIONS.tolerance = Number(value);
    else if (key === "--min-ms") OPTIONS.minMs = Number(value);
    else if (key === "--format") OPTIONS.format = value;
    else throw new Error(`不明な引数: ${key}`);
  }
  for (const required of ["base", "head"]) {
    if (!OPTIONS[required]) throw new Error(`--${required} がありません`);
  }
  if (!(OPTIONS.tolerance > 0)) throw new Error(`--tolerance が不正です: ${OPTIONS.tolerance}`);
  if (!(OPTIONS.minMs >= 0)) throw new Error(`--min-ms が不正です: ${OPTIONS.minMs}`);
}

function load(path) {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(parsed.results)) {
    throw new Error(`${path}: results 配列がありません（bench の出力ではない）`);
  }
  return parsed;
}

/** シナリオ名 -> 段名 -> {median, ...} */
function index(results) {
  const map = new Map();
  for (const result of results) map.set(result.scenario, result);
  return map;
}

const ms = (value) => (Number.isNaN(value) || value === undefined ? "-" : `${value.toFixed(2)}ms`);
const ratioText = (ratio) => (ratio === null ? "new" : `${ratio.toFixed(2)}x`);

/** 同じ観測条件で結果が比較可能か（データ規模が変わっていないか） */
function scaleWarnings(base, head) {
  const warnings = [];
  if (base.fixture?.name !== head.fixture?.name) {
    warnings.push(`フィクスチャが異なる: base=${base.fixture?.name} head=${head.fixture?.name}`);
  } else if (base.fixture?.nodeCount !== head.fixture?.nodeCount) {
    warnings.push(
      `フィクスチャのノード数が異なる: base=${base.fixture?.nodeCount} head=${head.fixture?.nodeCount}`,
    );
  }
  if (base.node !== head.node) {
    warnings.push(`Node が異なる: base=${base.node} head=${head.node}（比較の前提が崩れる）`);
  }
  if (base.mode !== head.mode) {
    warnings.push(`mode が異なる: base=${base.mode} head=${head.mode}`);
  }
  for (const [name, headResult] of index(head.results)) {
    const baseResult = index(base.results).get(name);
    if (!baseResult?.info || !headResult.info) continue;
    for (const key of ["searchGraphNodes", "searchGraphEdges", "pathLength", "componentEdges"]) {
      const b = baseResult.info[key];
      const h = headResult.info[key];
      // グラフ規模が変わると比較そのものが別ものになるので警告する
      if (b !== undefined && h !== undefined && b !== h) {
        warnings.push(`${name}.${key}: base=${b} head=${h}（データ規模が変化）`);
      }
    }
  }
  return warnings;
}

function compare(base, head) {
  const baseIndex = index(base.results);
  const headIndex = index(head.results);
  const scenarios = [];
  const regressions = [];

  for (const [name, headResult] of headIndex) {
    const baseResult = baseIndex.get(name);
    if (!baseResult) {
      scenarios.push({ name, rows: [{ stage: "(シナリオ追加)", base: null, head: null, ratio: null }] });
      continue;
    }
    const rows = [];
    const stageNames = [...new Set([...Object.keys(baseResult.stages), ...Object.keys(headResult.stages)])];
    for (const stage of stageNames) {
      const before = baseResult.stages[stage]?.median;
      const after = headResult.stages[stage]?.median;
      let ratio = null;
      if (before !== undefined && after !== undefined && before > 0) ratio = after / before;
      // 絶対時間がノイズ床を下回る段は比率が意味を持たない（0.02ms が 0.04ms になっても
      // 測定解像度の話で、性能の問題ではない）ので、回帰判定の対象から外す
      const gated = ratio !== null && before >= OPTIONS.minMs;
      rows.push({ stage, before, after, ratio, gated });
      if (gated && ratio > OPTIONS.tolerance) {
        regressions.push({ scenario: name, stage, before, after, ratio });
      }
    }
    // ratio の大きい順に見せる
    rows.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
    scenarios.push({ name, rows });
  }

  const removed = [...baseIndex.keys()].filter((name) => !headIndex.has(name));
  return { scenarios, regressions, removed };
}

function renderText({ scenarios, regressions, removed }, warnings) {
  const lines = [];
  for (const warning of warnings) lines.push(`  ! ${warning}`);
  if (warnings.length > 0) lines.push("");
  for (const scenario of scenarios) {
    lines.push(`## ${scenario.name}`);
    lines.push(`  ${"stage".padEnd(32)}${"base".padStart(10)}${"head".padStart(10)}${"ratio".padStart(9)}`);
    for (const row of scenario.rows) {
      if (row.before === null) {
        lines.push(`  ${row.stage.padEnd(32)}${"(追加)".padStart(10)}${"-".padStart(10)}${ratioText(null).padStart(9)}`);
        continue;
      }
      // 判定対象外の段には目印を付ける
      const mark = row.gated === false ? " *" : "";
      lines.push(
        `  ${(row.stage + mark).padEnd(32)}${ms(row.before).padStart(10)}${ms(row.after).padStart(10)}${ratioText(row.ratio).padStart(9)}`,
      );
    }
    lines.push("");
  }
  for (const name of removed) lines.push(`  (base にのみあるシナリオ: ${name})`);
  lines.push(`  (* = ${OPTIONS.minMs}ms 未満のため回帰判定の対象外)`);
  lines.push("");
  if (regressions.length > 0) {
    lines.push(`性能回帰を検出しました（許容 ${OPTIONS.tolerance}x）:`);
    for (const r of regressions) {
      lines.push(`  ${r.scenario}/${r.stage}: ${ms(r.before)} -> ${ms(r.after)} (${r.ratio.toFixed(2)}x)`);
    }
  } else {
    lines.push(`性能回帰なし（許容 ${OPTIONS.tolerance}x）`);
  }
  return lines.join("\n");
}

function renderMarkdown({ scenarios, regressions }, warnings) {
  const lines = [];
  for (const warning of warnings) lines.push(`> [!WARNING]\n> ${warning}`);
  for (const scenario of scenarios) {
    lines.push(`### ${scenario.name}`);
    lines.push("");
    lines.push("| stage | base | head | ratio |");
    lines.push("|---|---:|---:|---:|");
    for (const row of scenario.rows) {
      if (row.before === null) {
        lines.push(`| \`${row.stage}\` | (追加) | - | new |`);
        continue;
      }
      const mark = row.gated === false ? " *" : "";
      lines.push(`| \`${row.stage}${mark}\` | ${ms(row.before)} | ${ms(row.after)} | ${ratioText(row.ratio)} |`);
    }
    lines.push("");
  }
  lines.push(`* ${OPTIONS.minMs}ms 未満の段は回帰判定の対象外（比率が測定解像度の範囲に入るため）`);
  lines.push("");
  if (regressions.length > 0) {
    lines.push(`**性能回帰を検出しました（許容 ${OPTIONS.tolerance}x）**`);
    for (const r of regressions) {
      lines.push(`- \`${r.scenario}/${r.stage}\`: ${ms(r.before)} → ${ms(r.after)} (${r.ratio.toFixed(2)}x)`);
    }
  } else {
    lines.push(`性能回帰なし（許容 ${OPTIONS.tolerance}x）`);
  }
  return lines.join("\n");
}

try {
  parseArgs(process.argv.slice(2));
  const base = load(OPTIONS.base);
  const head = load(OPTIONS.head);
  const warnings = scaleWarnings(base, head);
  const result = compare(base, head);
  const text =
    OPTIONS.format === "markdown"
      ? renderMarkdown(result, warnings)
      : renderText(result, warnings);
  console.log(text);
  if (warnings.length > 0) process.exitCode = 2;
  else if (result.regressions.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`bench の比較に失敗しました: ${error.message}`);
  process.exit(2);
}
