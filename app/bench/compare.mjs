/**
 * 2 つの bench 結果 JSON を比べる。
 *
 * 使い方:
 *   node bench/compare.mjs --base base.json --head head.json [--tolerance 1.5]
 *   node bench/compare.mjs --base base.json --head head.json --format markdown
 *   node bench/compare.mjs --base base.json --head head.json [--calibration-tolerance 0.1]
 *   node bench/compare.mjs --base base.json --head head.json [--report-on-invalid]
 *
 * **比較するのは測定項目 ID 単位**で、ハーネスの同一性は求めない。
 * base は自分の bench で自分の `app/src` を測るので、head がハーネスを変えていようが
 * 同じ ID の測定項目同士は比較できる。app/src のモジュールを移動しただけの PR でも
 * 比較が成立する。
 *
 * ID は `{シナリオ}/{段}` の 1 つだけを持ち、測定条件は ID に入れない。
 * したがって同じ ID の測定項目どうしは常に同じ対象を指し、比べるのは `median` の比だけになる。
 * ID が両方になければ「追加」（head だけ）または「削除」（base だけ）として扱う。
 * どちらも「測定対象が変わった」ことを意味するので、回帰判定には入らないが表示する。
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
 * 測定項目が両側に 1 つも無いシナリオは比較対象ではないので、そのシナリオの
 * 校正は突き合わせない。
 *
 * 校正の仕事量の検算値 `work` も見る。同じ仕事をしたなら必ず同じ値になるので、これが
 * 違うときは `median` の時間が同じであっても「同じ仕事をした」保証が壊れているとみなす。
 * 時間の比較と仕事量の検算値の比較は別の失敗なので、別々に判定する。
 *
 * exit code:
 *   0  許容倍率以内（改善も含む）
 *   1  許容倍率を超えた測定項目がある（回帰）／結果 JSON が契約を守っていない
 *   2  比較そのものが成立しない（測定項目 ID が一致しない / 校正が外れている / 版が違う）
 *
 * 校正が通らないと回帰レポートごと出ないので、本物の回帰も一緒に隠れてしまう。
 * `--report-on-invalid` を付けると exit 2 を保ったまま「参考値（機械の状態が
 * 信用できない）」として回帰のリストを出す。比較できないことと、本当に遅くなったこと
 * を同時に読みたいためで、判定の結論（exit code）は変えない。
 *
 * 結果 JSON の構造は `lib/report.ts` が型と検証を持っている。
 * 版が違う JSON には測定項目 ID が入っていないので exit 2、版が同じで構造が
 * 契約を守っていないときは exit 1（契約違反は緑にしない）になる。
 */
import { readFileSync } from "node:fs";

import { parseBenchReport, SchemaViolationError, UnsupportedSchemaError } from "./lib/report.ts";

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

/** 結果 JSON を読み込んで検証する。版の違う JSON は比較不成立として扱う */
function load(path) {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  try {
    return parseBenchReport(parsed);
  } catch (error) {
    if (error instanceof UnsupportedSchemaError || error instanceof SchemaViolationError) {
      throw new BenchInputError(`${path}: ${error.message}`, error instanceof SchemaViolationError);
    }
    throw error;
  }
}

/** 入力 JSON が契約を守らなかったことを表す。契約違反だけ exit 1 にする */
class BenchInputError extends Error {
  constructor(message, violation) {
    super(message);
    this.name = "BenchInputError";
    this.violation = violation;
  }
}

const ms = (value) => (Number.isNaN(value) || value === undefined ? "-" : `${value.toFixed(2)}ms`);
const ratioText = (ratio) => (ratio === null ? "-" : `${ratio.toFixed(2)}x`);

/** 校正の測定値が「時間」として使える形か */
const usableMs = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

/** プレーンオブジェクトか（校正マップの検査に使う） */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 測定項目を ID 単位で突き合わせる。
 *
 * `rows` は追加と削除も含めて全 ID を含む。
 * 「追加」と「削除」は測定対象が変わったことを意味するので、回帰判定には入らない。
 */
function compareMeasurements(base, head) {
  const baseItems = base.measurements;
  const headItems = head.measurements;
  const warnings = [];

  const rows = [];
  const regressions = [];
  const ids = [...new Set([...Object.keys(baseItems), ...Object.keys(headItems)])].sort();
  // 両側に同じ ID が 1 つも無ければ比率の比較というものが成り立たない
  const common = ids.filter((id) => baseItems[id] !== undefined && headItems[id] !== undefined);
  if (common.length === 0) {
    warnings.push(
      `測定項目 ID が一致しません: base=${Object.keys(baseItems).length} 件 ` +
        `head=${Object.keys(headItems).length} 件、共通 0 件。` +
        "測定項目 ID を持つ bench の出力どうしを比較してください",
    );
  }
  for (const id of ids) {
    const before = baseItems[id];
    const after = headItems[id];
    if (before === undefined) {
      rows.push({ id, before: null, after: after.median, ratio: null });
      continue;
    }
    if (after === undefined) {
      rows.push({ id, before: before.median, after: null, ratio: null });
      continue;
    }
    const ratio = before.median > 0 ? after.median / before.median : null;
    // 絶対時間がノイズ床を下回る項目は比率が意味を持たない（0.02ms が 0.04ms になっても
    // 測定解像度の話で、性能の問題ではない）ので、回帰判定の対象から外す
    const gated = ratio !== null && before.median >= OPTIONS.minMs;
    rows.push({ id, before: before.median, after: after.median, ratio, gated });
    if (gated && ratio > OPTIONS.tolerance) {
      regressions.push({ id, before: before.median, after: after.median, ratio });
    }
  }
  // ratio の大きい順に見せる。追加と削除は最後にまとめる
  rows.sort((a, b) => {
    const rank = (row) => (row.before === null || row.after === null ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (b.ratio ?? -1) - (a.ratio ?? -1);
  });

  const added = rows.filter((r) => r.before === null).map((r) => r.id);
  const removed = rows.filter((r) => r.after === null).map((r) => r.id);
  return { rows, added, removed, regressions, warnings };
}

/**
 * 校正（`calibration`）を比べる。
 *
 * 2 つの校正は同じ仕事量で、base と head の計測の直前にそれぞれ 1 回だけ測っている。
 * したがって所要時間の比は「その 2 回の計測の間でランナーの状態がどれだけ変わったか」を
 * 示すだけで、段が実際に遅くなったことは示さない。だからこれが外れているときは
 * 「性能が悪化した」ではなく「比較が成立しない」として扱う。
 *
 * 項目ごと（`--min-ms` のノイズ床も）の判定とは独立で、どちらの項目が 0.5ms 未満であっても、
 * 或いは全部が一様に遅くあっても同じ判定になる。
 * 校正は 1 項目だけの話ではなく、項目の集合全体の話だから。
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
        "項目の差は信用できない（ジョブをもう一度動かすと解決する）",
    ],
  };
}

/** 校正レポートから `work` を全部抜き出す（どこで測ったかを一緒に持つ） */
function collectWorks(report) {
  const entries = [];
  const add = (where, value) => {
    if (typeof value === "number" && Number.isFinite(value)) entries.push({ where, value });
  };
  add("開始時", report.calibration?.work);
  for (const [name, calibration] of Object.entries(report.scenarioCalibration ?? {})) {
    add(`${name} の直前`, calibration?.work);
  }
  return entries;
}

function formatWorks(entries) {
  if (entries.length === 0) return "(なし)";
  return entries.map((e) => `${e.where} ${e.value}`).join(" / ");
}

/**
 * 校正の仕事量の検算値（`work`）の一致を見る。
 *
 * 校正は同じ仕事量を整数演算で回すだけなので、同じ Node で走らせれば必ず同じ値を返す。
 * つまり `median` が何倍であっても `work` は一致する。両者は別の失敗を見る:
 * `median` のずれは「機械の速さ」が変わったことを、`work` の不一致は
 * 「同じ仕事をした」保証が壊れたことを示す。Node の版や bench の版が違えば
 * 整数演算が別の最適化を受けて別の値になるので、このときは時間で見ても意味がない。
 * 判定の順序に意味はないので、両者は独立に判定する。
 */
function checkWork(base, head) {
  const before = collectWorks(base);
  const after = collectWorks(head);
  const values = new Set([...before, ...after].map((e) => e.value));
  const count = before.length + after.length;
  if (values.size === 0) {
    return {
      value: null,
      count,
      ok: false,
      warnings: [
        "校正の work がありません（同じ版の bench で 2 回とも計測し直してください）",
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
      `校正の work が一致しません（同じ仕事をした保証が壊れています）: base=${formatWorks(before)}` +
        ` / head=${formatWorks(after)}。校正の中身が違う（Node の版、bench の版、校正ワークロードの` +
        "いずれかが違う）ので、校正も項目も比較の対象にならない",
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
 *
 * 比較対象の測定項目が両側にあるシナリオだけを見る。
 * 追加または削除になったシナリオは項目を比較しないので、校正も比較しない。
 */
function checkScenarioCalibration(base, head, startOk, comparedScenarios) {
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

  const names = [...comparedScenarios].filter(
    (name) => name in baseMap && name in headMap,
  ).sort();
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
        `base と head でこのシナリオの計測は別々の状態で取られたので、このシナリオの項目の差は` +
        `信用できない（ジョブをもう一度動かすと解決する）。${where}`,
    );
  }
  return { entries, ok: entries.every((e) => e.ok), warnings };
}

/**
 * 「機械の状態」の判定を 1 つにまとめる。
 *
 * ここでの失敗は「項目が実際に遅くなった」ことではない。比較そのものが成立しないので
 * exit 2 に倒す。判定の段階は増やさないので、既存の 3 段階の枠に収まる。
 */
function checkMachine(base, head, comparedScenarios) {
  const calibration = checkCalibration(base, head);
  const work = checkWork(base, head);
  const scenarios = checkScenarioCalibration(base, head, calibration.ok, comparedScenarios);
  const warnings = [...calibration.warnings, ...work.warnings, ...scenarios.warnings];
  return { calibration, work, scenarios, warnings, ok: warnings.length === 0 };
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

/** 仕事量の検算値の結果を 1 行にまとめる */
function workText(work) {
  if (work.value === null) return `work: 比較できない（${work.count} 箇所）`;
  return `work: ${work.value} 一致（校正 ${work.count} 箇所すべて同じ値）`;
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
 * 比較が成立しなかったときは既定では回帰の判定を出さない（校正ゲートと ID の一致）。
 * `--report-on-invalid` を付けると、exit 2 を保ったまま「参考値（機械の状態が
 * 信用できない）」として回帰のリストを出す。変わるのは表示だけで、
 * 「比較が成立しない」という結論は変わらない。
 */
function verdict(invalid, regressions) {
  const reference = invalid && OPTIONS.reportOnInvalid;
  if (invalid && !reference) {
    return {
      heading:
        "比較が成立しないため、回帰の判定は出していません" +
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

/** ID は `{シナリオ}/{段}` なので 40 桁で揃える */
const ID_WIDTH = 40;

/** 1 行の測定項目を表示する。追加・削除はここで出す */
function rowText(row) {
  if (row.before === null) {
    return `  ${row.id.padEnd(ID_WIDTH)}${"(追加)".padStart(10)}${ms(row.after).padStart(10)}${"-".padStart(9)}`;
  }
  if (row.after === null) {
    return `  ${row.id.padEnd(ID_WIDTH)}${ms(row.before).padStart(10)}${"(削除)".padStart(10)}${"-".padStart(9)}`;
  }
  // 判定対象外の項目には目印を付ける
  const mark = row.gated === false ? " *" : "";
  return (
    `  ${(row.id + mark).padEnd(ID_WIDTH)}${ms(row.before).padStart(10)}` +
    `${ms(row.after).padStart(10)}${ratioText(row.ratio).padStart(9)}`
  );
}

/** 追加と削除のまとめ。どちらも「測定対象が変わった」ことを示す */
function changeText(added, removed) {
  const lines = [];
  if (added.length > 0) lines.push(`  追加（head だけ）: ${added.join(", ")}`);
  if (removed.length > 0) lines.push(`  削除（base だけ）: ${removed.join(", ")}`);
  if (added.length === 0 && removed.length === 0) {
    lines.push("  追加・削除の測定項目はありません（ID の集合が同じ）");
  }
  return lines;
}

function renderText(result, gate, warnings) {
  const lines = [];
  for (const warning of warnings) lines.push(`  ! ${warning}`);
  if (warnings.length > 0) lines.push("");
  lines.push(`  ${"id".padEnd(ID_WIDTH)}${"base".padStart(10)}${"head".padStart(10)}${"ratio".padStart(9)}`);
  for (const row of result.rows) lines.push(rowText(row));
  lines.push("");
  lines.push(`  (* = ${OPTIONS.minMs}ms 未満のため回帰判定の対象外)`);
  lines.push("");
  for (const line of changeText(result.added, result.removed)) lines.push(line);
  lines.push("");
  lines.push(`  ${calibrationText(gate.calibration)}`);
  lines.push(`  ${workText(gate.work)}`);
  for (const line of scenarioCalibrationLines(gate.scenarios)) lines.push(`  ${line}`);
  const result_ = verdict(gate.ok === false || warnings.length > 0, result.regressions);
  lines.push(`  ${result_.heading}`);
  for (const r of result_.items) {
    lines.push(`  ${r.id}: ${ms(r.before)} -> ${ms(r.after)} (${r.ratio.toFixed(2)}x)`);
  }
  return lines.join("\n");
}

function renderMarkdown(result, gate, warnings) {
  const lines = [];
  lines.push("| id | base | head | ratio |");
  lines.push("|---|---:|---:|---:|");
  for (const row of result.rows) {
    if (row.before === null) {
      lines.push(`| \`${row.id}\` | (追加) | ${ms(row.after)} | - |`);
      continue;
    }
    if (row.after === null) {
      lines.push(`| \`${row.id}\` | ${ms(row.before)} | (削除) | - |`);
      continue;
    }
    const mark = row.gated === false ? " *" : "";
    lines.push(`| \`${row.id}${mark}\` | ${ms(row.before)} | ${ms(row.after)} | ${ratioText(row.ratio)} |`);
  }
  lines.push("");
  lines.push(
    `追加・削除は「測定対象が変わった」ことを示すので、回帰判定には入らない。` +
      `追加 ${result.added.length} 件 / 削除 ${result.removed.length} 件`,
  );
  if (result.added.length > 0) lines.push(`- 追加（head だけ）: ${result.added.map((id) => `\`${id}\``).join(", ")}`);
  if (result.removed.length > 0) lines.push(`- 削除（base だけ）: ${result.removed.map((id) => `\`${id}\``).join(", ")}`);
  lines.push("");
  lines.push(`* ${OPTIONS.minMs}ms 未満の項目は回帰判定の対象外`);
  lines.push("");
  lines.push(`**${calibrationText(gate.calibration)}**`);
  lines.push(gate.work.value === null ? `**${workText(gate.work)}**` : workText(gate.work));
  if (gate.scenarios.entries.length > 0) {
    lines.push("**シナリオ直前の calibration:**");
    for (const entry of gate.scenarios.entries) {
      const ratio = entry.ratio === null ? "判定不能" : `${entry.ratio.toFixed(2)}x`;
      lines.push(
        `- \`${entry.name}\`: ${ms(entry.before)} → ${ms(entry.after)} (${ratio}) ${entry.ok ? "通過" : "不通過"}`,
      );
    }
  }
  const result_ = verdict(gate.ok === false || warnings.length > 0, result.regressions);
  lines.push(`**${result_.heading}**`);
  for (const r of result_.items) {
    lines.push(`- \`${r.id}\`: ${ms(r.before)} → ${ms(r.after)} (${r.ratio.toFixed(2)}x)`);
  }
  return lines.join("\n");
}

/**
 * 比較不成立の理由要先頭に置くので、警告行を別に組み立てる。
 *
 * exit 2 のときは job summary の最初にあるので、表より先に結論が来る。
 */
function renderWarnings(warnings) {
  if (warnings.length === 0) return [];
  return ["> [!WARNING]", ...warnings.map((w) => `> ${w}`)];
}

try {
  parseArgs(process.argv.slice(2));
  const base = load(OPTIONS.base);
  const head = load(OPTIONS.head);
  const result = compareMeasurements(base, head);
  // 比較した項目のあるシナリオだけ、シナリオ直前の校正を突き合わせる
  const comparedScenarios = new Set(
    result.rows
      .filter((row) => row.before !== null && row.after !== null)
      .map((row) => row.id.slice(0, row.id.indexOf("/"))),
  );
  const gate = checkMachine(base, head, comparedScenarios);
  // 測定項目側の不備も「比較が成立しない」側に載せる。exit 2 は警告が 1 つでもあるかどうかで決まる
  const warnings = [...result.warnings, ...gate.warnings];
  const text =
    OPTIONS.format === "markdown"
      ? [...renderWarnings(warnings), renderMarkdown(result, gate, warnings)].join("\n\n")
      : renderText(result, gate, warnings);
  console.log(text);
  if (warnings.length > 0) process.exitCode = 2;
  else if (result.regressions.length > 0) process.exitCode = 1;
} catch (error) {
  const violation = error instanceof BenchInputError && error.violation;
  console.error(
    violation
      ? `bench の結果が契約を守っていません: ${error.message}`
      : `bench の比較に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
  );
  // 版が違えば比較というものが成り立たない（exit 2）。
  // 版が同じで構造が壊れていれば契約違反なので赤にする（exit 1）
  process.exit(violation ? 1 : 2);
}