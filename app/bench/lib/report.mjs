/**
 * bench の結果 JSON から「測定項目」を取り出す比較側共通の部品。
 *
 * 比較は base と head を ID 単位で突き合わせる。base の JSON は base の版が作ったものなので、
 * どの階層に何があるかは base の版次第であり、共有する契約は次の 3 つだけにする。
 *
 * | 共有するもの | 取り出し方 |
 * |---|---|
 * | 測定項目 ID | `{シナリオ}/{段}` の文字列 |
 * | 測定値 | `median`（中央値、ms） |
 * | 測定条件 | `conditions` の中の `mode` / `iterations` / `warmup` / `fixture` / `fixtureNodeCount` / `node` |
 *
 * そのため、JSON の構造を固定せず再帰的に走査して
 * 「ID を持つオブジェクトで `median` が数値のもの」を探す。
 * 構造が違っても ID と測定値を取り出せる限りは比較できる。
 */

/** 測定項目 ID の形: `{シナリオ}/{段}` */
export const STAGE_ID_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/** プレーンオブジェクトか */
export const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 結果 JSON から測定項目を ID で引く。
 *
 * 返るのは `ID -> { value, conditions }` の写像。
 * 取り出せなかった項目は compare.mjs の側で「追加」「削除」として明示する。
 */
export function extractMeasurements(report) {
  const found = new Map();
  walk(report);
  return found;

  function walk(node) {
    if (Array.isArray(node)) {
      for (const value of node) walk(value);
      return;
    }
    if (!isRecord(node)) return;
    if (isMeasurement(node)) {
      // 同じ ID が二重に現れたら最初に現れたものを採用する
      if (!found.has(node.id)) {
        found.set(node.id, { value: node.median, conditions: node.conditions });
      }
    }
    for (const value of Object.values(node)) walk(value);
  }
}

/** ID を持つ測定項目か */
function isMeasurement(node) {
  return (
    typeof node.id === "string" &&
    STAGE_ID_PATTERN.test(node.id) &&
    typeof node.median === "number" &&
    Number.isFinite(node.median)
  );
}

/**
 * 測定項目 ID を持たない旧形式の結果から、測定項目を復元する。
 *
* 測定項目 ID を持ち始める前の bench は、`results[].stages` に段名だけを並べ、
 * 測定条件を持っていなかった。ID を導入した直後は base がまだ旧形式の JSON を
 * 出すので、この形式からも ID を組み立てて比較できるようにしている。
 *
 * 復元できるのは ID と測定値、そして次の測定条件だけ。
 *
 * | 旧形式から取れる | 出所 |
 * |---|---|
 * | `mode` | トップレベルの `mode` |
 * | `iterations` | `stages[段].iterations`（暖機を除いた実測回数） |
 * | `fixture` | `fixture.name` |
 * | `node` | トップレベルの `node` |
 *
 * `warmup` と `fixtureNodeCount` は旧形式と同じ定義の値が残っていない。
 * 特に `fixtureNodeCount` は旧形式の `info.fixtureNodes`（要素から数えた値）と
 * 定義が違うので、`info.fixtureNodes` を当てはめてはならない。
 * この 2 つは比較対象外になるが、検証できなかった Keys として呼び出し側へ伝える。
 */
const LEGACY_UNVERIFIABLE = ["warmup", "fixtureNodeCount"];

/**
 * 旧形式なら `ID -> { value, conditions }` と検証できなかった Keys を返す。
 * 旧形式でなければ `null`。
 */
export function extractLegacyMeasurements(report) {
  if (!isRecord(report) || !Array.isArray(report.results)) return null;

  const items = new Map();
  const fixtureName = isRecord(report.fixture) ? report.fixture.name : undefined;

  for (const result of report.results) {
    if (!isRecord(result)) continue;
    const scenario = result.scenario;
    if (typeof scenario !== "string" || !isRecord(result.stages)) continue;

    for (const [stage, samples] of Object.entries(result.stages)) {
      if (!isRecord(samples)) continue;
      if (typeof samples.median !== "number" || !Number.isFinite(samples.median)) continue;
      const id = `${scenario}/${stage}`;
      if (items.has(id)) continue;

      // 旧形式に無い項目は入れない。無い Keys を「片側だけある Keys」扱いすると
      // 測定条件の差として扱われてしまうため
      const conditions = {};
      if (report.mode !== undefined) conditions.mode = report.mode;
      if (samples.iterations !== undefined) conditions.iterations = samples.iterations;
      if (fixtureName !== undefined) conditions.fixture = fixtureName;
      if (report.node !== undefined) conditions.node = report.node;

      items.set(id, { value: samples.median, conditions });
    }
  }

  if (items.size === 0) return null;
  return { items, unverifiable: LEGACY_UNVERIFIABLE };
}

/**
 * 新しい形式と旧形式の両方から取り出す。
 *
 * 返るのは `ID -> { value, conditions }` の写像と、
 * 旧形式を復元したかどうか、復元した時点で検証できなかった Keys。
 */
export function extractComparable(report) {
  const items = extractMeasurements(report);
  if (items.size > 0) return { items, legacy: false, unverifiable: [] };

  const legacy = extractLegacyMeasurements(report);
  if (legacy === null) return { items, legacy: false, unverifiable: [] };
  return { items: legacy.items, legacy: true, unverifiable: legacy.unverifiable };
}

/**
 * 観測したデータ規模を取り出す。
 *
 * `searchGraphEdges` などが変わると段の絶対値も変わるので、比較の前提を壊している。
 * 契約には含めない診断用の情報なので、既知のキーが両方に出たときだけ警告する。
 */
const SCALE_KEYS = [
  "searchGraphNodes",
  "searchGraphEdges",
  "componentEdges",
  "pathLength",
];

export function extractScale(report) {
  const scale = new Map();
  walk(report);
  return scale;

  function walk(node) {
    if (Array.isArray(node)) {
      for (const value of node) walk(value);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (SCALE_KEYS.includes(key) && (typeof value === "number" || typeof value === "string")) {
        if (!scale.has(key)) scale.set(key, value);
        continue;
      }
      walk(value);
    }
  }
}
