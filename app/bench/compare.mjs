/**
 * 2 つの bench 結果 JSON を比べる。
 *
 * 使い方:
 *   node bench/compare.mjs --base base.json --head head.json [--tolerance 1.5]
 *   node bench/compare.mjs --base base.json --head head.json --format markdown
 *   node bench/compare.mjs --base base.json --head head.json [--calibration-tolerance 0.1]
 *   node bench/compare.mjs --base base.json --head head.json [--report-on-invalid]
 *
 * なぜ base と head を 2 回測るか:
 * 記録用の基準ファイルをリポジトリに持つと、CPU も Node も違うランナーで
 * 取得した値が混ざり、PR 同士で基準ファイルが衝突する。CI 上で同じランナー・
 * 同じフィクスチャで 2 回測って比べるなら、差分はそのまま PR の変更による
 * ものとして読める。
 *
 * ただし「同じランナー」であっても、2 回の計測の間にランナーの状態が変わることはある。
 * 2026-10-02 の PR #100 では、`path_finder.ts` の 4 行だけの変更で 21 段中 19 段が
 * 一様に 1.02〜1.63 倍遅くなり、head 側の最大値には 2.5 倍の外れ値が混じっていた。
 * 共有ランナーの負荷の不安定さは普通にあるので、これと「本当に遅くなった」を
 * 区別するために校正（`calibration`）を前置する。校正はアプリに依存しない固定仕事量の
 * 整数演算で、2 回の計測の直前に 1 回ずつ測る。仕事量は同じなので所要時間だけが
 * 機械の速度を反映し、この 2 つが想定の範囲を外れていれば段の差は信用できない。
 *
 * 開始時の校正 1 回では「計測の途中でランナーが遅くなった」ことを語れない。そのため
 * 各シナリオの直前にも校正を測り（`scenarioCalibration`）、base と head の
 * 「シナリオ N の直前」がずれているかを別々に見る。ずれていれば、比較不成立の理由を
 * どのシナリオまで絞って言えるので、ジョブの再実行で直るかも判断できる。
 *
 * 校正の検算値 `checksum` も見る。同じ仕事をしたなら必ず同じ値になるので、これが
 * 違うときは `median` の時間が同じであっても「同じ仕事をした」保証が壊れているとみなす。
 * 時間の比較と検算値の比較は別の失敗なので、別々に判定する。
 *
 * exit code:
 *   0  許容倍率以内（改善も含む）
 *   1  許容倍率を超えた段がある（回帰）
 *   2  比較そのものが成立しない（フィクスチャや Node が違う / 校正が外れている / 入力が不正）
 *
 * 校正が通らないと回帰レポートごと出ないので、本物の回帰も一緒に隠れてしまう。
 * `--report-on-invalid` を付けると exit 2 を保ったまま「参考値（機械の状態が
 * 信用できない）」として回帰のリストを出す。比較できないことと、本当に遅くなったこと
 * を同時に読みたいためで、判定の結論（exit code）は変えない。
 */
import { readFileSync } from "node:fs";

const OPTIONS = {
  tolerance: 1.5,
  format: "text",
  minMs: 0.5,
  calibrationTolerance: 0.1,
  /** 校正が通らなかったときも「参考値」として回帰リストを出す */
  reportOnInvalid: false,
};

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    // 値を持たないフラグは次の引数を消費してはいけない。分岐を先に書いてから取得する
    if (key === "--report-on-invalid") {
      OPTIONS.reportOnInvalid = true;
      continue;
    }
    const value = argv[++i];
    if (key === "--base") OPTIONS.base = value;
    else if (key === "--head") OPTIONS.head = value;
    else if (key === "--tolerance") OPTIONS.tolerance = Number(value);
    else if (key === "--min-ms") OPTIONS.minMs = Number(value);
    else if (key === "--calibration-tolerance") OPTIONS.calibrationTolerance = Number(value);
    else if (key === "--format") OPTIONS.format = value;
    else throw new Error(`不明な引数: ${key}`);
  }
  for (const required of ["base", "head"]) {
    if (!OPTIONS[required]) throw new Error(`--${required} がありません`);
  }
  if (!(OPTIONS.tolerance > 0)) throw new Error(`--tolerance が不正です: ${OPTIONS.tolerance}`);
  if (!(OPTIONS.minMs >= 0)) throw new Error(`--min-ms が不正です: ${OPTIONS.minMs}`);
  if (!(OPTIONS.calibrationTolerance >= 0)) {
    throw new Error(`--calibration-tolerance が不正です: ${OPTIONS.calibrationTolerance}`);
  }
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

/** 校正の測定値が「時間」として使える形か */
const usableMs = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

/** プレーンオブジェクトか（校正マップの検査に使う） */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 校正（`calibration`）を比べる。
 *
 * 2 つの校正は同じ仕事量で、base と head の計測の直前にそれぞれ 1 回だけ測っている。
 * したがって所要時間の比は「その 2 回の計測の間でランナーの状態がどれだけ変わったか」を
 * 示すだけで、段が実際に遅くなったことは示さない。だからこれが外れているときは
 * 「性能が悪化した」ではなく「比較が成立しない」として扱う。
 *
 * 段ごと（`--min-ms` のノイズ床も）の判定とは独立で、どちらの段が 0.5ms 未満であっても、
 * 或いは 21 段全部が一様に遅くあっても同じ判定になる。
 * 校正は 1 段だけの話ではなく、段の集合全体の話だから。
 */
function checkCalibration(base, head) {
  const before = base.calibration?.median;
  const after = head.calibration?.median;
  if (!usableMs(before) || !usableMs(after)) {
    return {
      before,
      after,
      ratio: null,
      ok: false,
      warnings: [
        `校正の測定値が無い、または不正です: base=${ms(before)} head=${ms(after)}` +
          "（同じ版の bench で 2 回とも計測し直してください）",
      ],
    };
  }
  const ratio = after / before;
  const ok = Math.abs(ratio - 1) <= OPTIONS.calibrationTolerance;
  if (ok) return { before, after, ratio, ok, warnings: [] };
  return {
    before,
    after,
    ratio,
    ok,
    warnings: [
      `校正で機械の速度が変わった可能性: ${ms(before)} -> ${ms(after)} (${ratio.toFixed(2)}x、` +
        `許容は 1±${OPTIONS.calibrationTolerance} まで)。2 回の計測の間でランナーの負荷が変わったので、` +
        "段の差は信用できない（ジョブをもう一度動かすと解決する）",
    ],
  };
}

/**
 * 校正の検算値（`checksum`）の一致を見る。
 *
 * 校正は同じ仕事量を整数演算で回すだけなので、同じ Node で走らせれば必ず同じ値を返す。
 * つまり `median` が何倍であっても `checksum` は一致する。両者は別の失敗を見る:
 * `median` のずれは「機械の速さ」が変わったことを、`checksum` の不一致は
 * 「同じ仕事をした」保証が壊れたことを示す。Node の版や bench の版が違えば
 * 整数演算が別の最適化を受けて別の値になるので、このときは時間で見ても意味がない。
 * 判定の順序に意味はないので、両者は独立に判定する。
 */

/** 校正レポートから `checksum` を全部抜き出す（どこで測ったかを一緒に持つ） */
function collectChecksums(report) {
  const entries = [];
  const add = (where, value) => {
    if (typeof value === "number" && Number.isFinite(value)) entries.push({ where, value });
  };
  add("開始時", report.calibration?.checksum);
  for (const [name, calibration] of Object.entries(report.scenarioCalibration ?? {})) {
    add(`${name} の直前`, calibration?.checksum);
  }
  return entries;
}

function formatChecksums(entries) {
  if (entries.length === 0) return "(なし)";
  return entries.map((e) => `${e.where} ${e.value}`).join(" / ");
}

function checkChecksum(base, head) {
  const before = collectChecksums(base);
  const after = collectChecksums(head);
  const values = new Set([...before, ...after].map((e) => e.value));
  const count = before.length + after.length;
  if (values.size === 0) {
    return {
      value: null,
      count,
      ok: false,
      warnings: [
        "校正の checksum がありません（同じ版の bench で 2 回とも計測し直してください）",
      ],
    };
  }
  if (values.size === 1) {
    return { value: [...values][0], count, ok: true, warnings: [] };
  }
  return {
    value: null,
    count,
    ok: false,
    warnings: [
      `校正の checksum が一致しません（同じ仕事をした保証が壊れています）: base=${formatChecksums(before)}` +
        ` / head=${formatChecksums(after)}。校正の中身が違う（Node の版・bench の版・校正ワークロードの` +
        "いずれかが違う）ので、校正も段も比較の対象にならない",
    ],
  };
}

/**
 * シナリオ直前の校正を base と head で突き合わせる。
 *
 * 開始時の校正 1 回では「計測の途中でランナーが遅くなった」ことを語れない。
 * 2026-10-02 の PR #100 の `pipeline` の `fold2DegreeEdges` は、base が
 * min 34.97ms / median 47.32ms / max 62.59ms だったのに対して head が
 * min 50.10ms / median 76.91ms / max 157.93ms で、最小値も中央値も上がり外れ値も
 * 大きくなっていた。開始時は正常で途中から遅くなったなら、開始時の校正は一致したまま
 * シナリオ N の直前の校正だけがずれる。だからシナリオごとに見れば、どこで遅れたかが分かる。
 *
 * 判定は開始時の校正と同じ仕組み（`--tolerance` とは独立した `--calibration-tolerance`）で、
 * 警告文にはシナリオ名を出す。この警告が 1 つでもあれば exit 2 で、既存の 3 段階の
 * 枠に収まるので新しい exit code は増やさない。
 */
function checkScenarioCalibration(base, head, startOk) {
  const baseMap = base.scenarioCalibration;
  const headMap = head.scenarioCalibration;
  if (!isRecord(baseMap) || !isRecord(headMap)) {
    return {
      entries: [],
      ok: false,
      warnings: [
        "シナリオ直前の校正が無い、または不正です（同じ版の bench で 2 つとも計測し直してください）",
      ],
    };
  }

  const names = [...new Set([...Object.keys(baseMap), ...Object.keys(headMap)])];
  const entries = [];
  const warnings = [];
  for (const name of names) {
    const before = baseMap[name]?.median;
    const after = headMap[name]?.median;
    if (!usableMs(before) || !usableMs(after)) {
      entries.push({ name, before, after, ratio: null, ok: false });
      warnings.push(
        `シナリオ "${name}" の直前の校正が無い、または不正です: base=${ms(before)} head=${ms(after)}`,
      );
      continue;
    }
    const ratio = after / before;
    const ok = Math.abs(ratio - 1) <= OPTIONS.calibrationTolerance;
    entries.push({ name, before, after, ratio, ok });
    if (ok) continue;
    // 開始時の校正が一致しているなら「序盤は正常で、このシナリオの直前だけ遅くなった」と読める
    const where = startOk
      ? "開始時の校正は一致しているので、遅れたのは計測の途中だったと分かる"
      : "開始時の校正もずれているので、どこで変わったのかは分からない";
    warnings.push(
      `シナリオ "${name}" の直前の校正で機械の速度が変わった可能性: ${ms(before)} -> ${ms(after)}` +
        ` (${ratio.toFixed(2)}x、許容は 1±${OPTIONS.calibrationTolerance} まで)。` +
        `base と head でこのシナリオの計測は別々の状態で取られたので、このシナリオの段の差は` +
        `信用できない（ジョブをもう一度動かすと解決する）。${where}`,
    );
  }
  return { entries, ok: entries.every((e) => e.ok), warnings };
}

/**
 * 「機械の状態」の判定を 1 つにまとめる。
 *
 * ここでの失敗は「段が実際に遅くなった」ことではない。比較そのものが成立しないので
 * exit 2 に倒す。判定の段階は増やさないので、既存の 3 段階の枠に収まる。
 */
function checkMachine(base, head) {
  const calibration = checkCalibration(base, head);
  const checksum = checkChecksum(base, head);
  const scenarios = checkScenarioCalibration(base, head, calibration.ok);
  const warnings = [...calibration.warnings, ...checksum.warnings, ...scenarios.warnings];
  return { calibration, checksum, scenarios, warnings, ok: warnings.length === 0 };
}

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

/** 校正の結果を 1 行にまとめる */
function calibrationText(calibration) {
  if (calibration.ratio === null) {
    return `calibration: base=${ms(calibration.before)} head=${ms(calibration.after)} 判定不能`;
  }
  const verdict = calibration.ok ? `通過（許容 ±${OPTIONS.calibrationTolerance}）` : "不通過（比較不成立）";
  return (
    `calibration: ${ms(calibration.before)} -> ${ms(calibration.after)} ` +
    `(${calibration.ratio.toFixed(2)}x) ${verdict}`
  );
}

/** 検算値の結果を 1 行にまとめる */
function checksumText(checksum) {
  if (checksum.value === null) return `checksum: 比較できない（${checksum.count} 箇所）`;
  return `checksum: ${checksum.value} 一致（校正 ${checksum.count} 箇所すべて同じ値）`;
}

/** シナリオ直前の校正を 1 行ずつにまとめる */
function scenarioCalibrationLines(scenarios) {
  if (scenarios.entries.length === 0) return [];
  const lines = ["シナリオ直前の calibration:"];
  for (const entry of scenarios.entries) {
    const ratio = entry.ratio === null ? "判定不能" : `${entry.ratio.toFixed(2)}x`;
    const verdict = entry.ok ? "通過" : "不通過";
    lines.push(
      `  ${entry.name.padEnd(14)}${ms(entry.before).padStart(9)} -> ${ms(entry.after).padStart(9)}` +
        `  (${ratio.padStart(8)}) ${verdict}`,
    );
  }
  return lines;
}

/**
 * 回帰の判定（または参考値）の見出しと明細を組み立てる。
 *
 * 機械の判定が通らなかったときは既定では回帰の判定を出さない（校正ゲート）。
 * `--report-on-invalid` を付けると、exit 2 を保ったまま「参考値（機械の状態が
 * 信用できない）」として回帰のリストを出す。変わるのは表示だけで、
 * 「比較が成立しない」という結論は変わらない。
 */
function verdict(gate, regressions) {
  const invalid = !gate.ok;
  const reference = invalid && OPTIONS.reportOnInvalid;
  if (invalid && !reference) {
    return {
      heading:
        "校正が成立しないため、回帰の判定は出していません" +
        "（--report-on-invalid を付けると参考値として出ます）",
      items: [],
    };
  }
  if (regressions.length === 0) {
    return {
      heading: reference
        ? `性能回帰なし（参考値。機械の状態が信用できないため判定ではない、許容 ${OPTIONS.tolerance}x）`
        : `性能回帰なし（許容 ${OPTIONS.tolerance}x）`,
      items: [],
    };
  }
  return {
    heading: reference
      ? `性能回帰の参考値（機械の状態が信用できないため判定ではない。許容 ${OPTIONS.tolerance}x）:`
      : `性能回帰を検出しました（許容 ${OPTIONS.tolerance}x）:`,
    items: regressions,
  };
}

function renderText({ scenarios, regressions, removed }, warnings, gate) {
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
  lines.push(`  ${calibrationText(gate.calibration)}`);
  lines.push(`  ${checksumText(gate.checksum)}`);
  for (const line of scenarioCalibrationLines(gate.scenarios)) lines.push(`  ${line}`);
  const result = verdict(gate, regressions);
  lines.push(`  ${result.heading}`);
  for (const r of result.items) {
    lines.push(`  ${r.scenario}/${r.stage}: ${ms(r.before)} -> ${ms(r.after)} (${r.ratio.toFixed(2)}x)`);
  }
  return lines.join("\n");
}

function renderMarkdown({ scenarios, regressions }, warnings, gate) {
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
  lines.push(`**${calibrationText(gate.calibration)}**`);
  lines.push(gate.checksum.value === null ? `**${checksumText(gate.checksum)}**` : checksumText(gate.checksum));
  if (gate.scenarios.entries.length > 0) {
    lines.push("**シナリオ直前の calibration:**");
    for (const entry of gate.scenarios.entries) {
      const ratio = entry.ratio === null ? "判定不能" : `${entry.ratio.toFixed(2)}x`;
      lines.push(
        `- \`${entry.name}\`: ${ms(entry.before)} → ${ms(entry.after)} (${ratio}) ${entry.ok ? "通過" : "不通過"}`,
      );
    }
  }
  const result = verdict(gate, regressions);
  lines.push(`**${result.heading}**`);
  for (const r of result.items) {
    lines.push(`- \`${r.scenario}/${r.stage}\`: ${ms(r.before)} → ${ms(r.after)} (${r.ratio.toFixed(2)}x)`);
  }
  return lines.join("\n");
}

try {
  parseArgs(process.argv.slice(2));
  const base = load(OPTIONS.base);
  const head = load(OPTIONS.head);
  const gate = checkMachine(base, head);
  // 校正の不備も「比較が成立しない」側に載せる。exit 2 はこの配列が空かどうかで決まる
  const warnings = [...scaleWarnings(base, head), ...gate.warnings];
  const result = compare(base, head);
  const text =
    OPTIONS.format === "markdown"
      ? renderMarkdown(result, warnings, gate)
      : renderText(result, warnings, gate);
  console.log(text);
  if (warnings.length > 0) process.exitCode = 2;
  else if (result.regressions.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`bench の比較に失敗しました: ${error.message}`);
  process.exit(2);
}
