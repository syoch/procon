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
