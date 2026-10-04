/**
 * bench の結果 JSON のスキーマ。
 *
 * base と head を突き合わせるときに共有する契約は ID と測定値だけだが、
 * その 2 つを取り出せるようにするには「JSON がどの形か」を決める必要がある。
 * 取り出す側（compare.mjs）と作る側（run.ts）が同じ型と検証を持っている。
 *
 * 測定項目 ID は既知の定数集合（`bench/ids.ts`）なので、JSON の構造は固定する。
 * ID は `measurements` のキーにそのまま入る。
 * キーの集合が base と head で違う場合は「追加」「削除」として compare.mjs が明示する。
 */

/** 結果 JSON の版。構造を変えたらこれを変え、型と検証を同時に更新する */
export const SCHEMA_VERSION = 1;

/** 測定項目 ID の形: `{シナリオ}/{段}` */
export const STAGE_ID_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/** 1 件の測定値 */
export type Measurement = {
  /** 実測した回の中央値 [ms] */
  median: number;
  /** 最小値 [ms] */
  min: number;
  /** 最大値 [ms] */
  max: number;
  /** 測定回数（暖機した回を除く） */
  iterations: number;
  /** 実測した総時間 [ms] */
  total: number;
};

/** 校正の測定値。アプリに依存しない固定仕事量の所要時間と、仕事量の検算値 */
export type Calibration = Measurement & {
  /** 仕事量の検算値。同じ Node で走らせれば必ず同じ値になる */
  work: number;
};

/** シナリオごとの補足。比較には使わないので自由な値を保持する */
export type ScenarioSummary = {
  scenario: string;
  /** 各段の中央値を足したもの [ms] */
  total: number;
  info?: Record<string, string | number | boolean>;
};

/** bench が書き出す結果 JSON */
export type BenchReport = {
  schemaVersion: typeof SCHEMA_VERSION;
  /** 測定項目 ID -> 測定値 */
  measurements: Record<string, Measurement>;
  /** 開始時の校正 */
  calibration: Calibration;
  /** シナリオ名 -> そのシナリオを走らせる直前に測った校正 */
  scenarioCalibration: Record<string, Calibration>;
  /** シナリオごとの補足 */
  results: ScenarioSummary[];
};

const MEASUREMENT_KEYS = ["median", "min", "max", "iterations", "total"] as const;
const CALIBRATION_KEYS = [...MEASUREMENT_KEYS, "work"] as const;

/**
 * 結果 JSON の版が想定と違う。
 *
 * 別の版が作った JSON には測定項目 ID が入っていないので、比較というものが成り立たない。
 * compare.mjs はこれを「比較不成立」（exit 2）として扱う。
 */
export class UnsupportedSchemaError extends Error {
  override readonly name = "UnsupportedSchemaError";
}

/** 版は合うが構造が契約を守っていない。compare.mjs はこれを契約違反（exit 1）として扱う */
export class SchemaViolationError extends Error {
  override readonly name = "SchemaViolationError";
}

/** プレーンオブジェクトか */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 有限の数値か */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** 指定したキーがすべて有限の数値か。不足しているキーを 1 つずつ挙げてエラーにする */
function parseNumbers(
  raw: unknown,
  keys: readonly string[],
  where: string,
): Record<string, number> {
  if (!isRecord(raw)) {
    throw new SchemaViolationError(`${where} がオブジェクトではありません`);
  }
  const out: Record<string, number> = {};
  const invalid: string[] = [];
  for (const key of keys) {
    if (!isFiniteNumber(raw[key])) invalid.push(key);
    else out[key] = raw[key];
  }
  if (invalid.length > 0) {
    throw new SchemaViolationError(`${where} に数値でない値があるか、値が無い: ${invalid.join(", ")}`);
  }
  return out;
}

/** 測定項目の集合。キーがそのまま測定項目 ID になる */
function parseMeasurements(raw: unknown): Record<string, Measurement> {
  if (!isRecord(raw)) {
    throw new SchemaViolationError("measurements がオブジェクトではありません");
  }
  const out: Record<string, Measurement> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!STAGE_ID_PATTERN.test(id)) {
      throw new SchemaViolationError(`測定項目 ID の形が {シナリオ}/{段} ではありません: ${id}`);
    }
    out[id] = parseNumbers(value, MEASUREMENT_KEYS, `measurements["${id}"]`) as Measurement;
  }
  return out;
}

/** 校正の集合（開始時の 1 件と、シナリオごとのもの） */
function parseCalibrations(raw: unknown, where: string): Record<string, Calibration> {
  if (!isRecord(raw)) {
    throw new SchemaViolationError(`${where} がオブジェクトではありません`);
  }
  const out: Record<string, Calibration> = {};
  for (const [name, value] of Object.entries(raw)) {
    out[name] = parseNumbers(value, CALIBRATION_KEYS, `${where}["${name}"]`) as Calibration;
  }
  return out;
}

/** シナリオごとの補足 */
function parseScenarioSummaries(raw: unknown): ScenarioSummary[] {
  if (!Array.isArray(raw)) {
    throw new SchemaViolationError("results が配列ではありません");
  }
  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new SchemaViolationError(`results[${index}] がオブジェクトではありません`);
    }
    if (typeof entry.scenario !== "string") {
      throw new SchemaViolationError(`results[${index}].scenario が文字列ではありません`);
    }
    if (!isFiniteNumber(entry.total)) {
      throw new SchemaViolationError(`results[${index}].total が数値ではありません`);
    }
    if (entry.info !== undefined && !isRecord(entry.info)) {
      throw new SchemaViolationError(`results[${index}].info がオブジェクトではありません`);
    }
    return entry as unknown as ScenarioSummary;
  });
}

/**
 * 結果 JSON を読んで検証する。
 *
 * 版の違う JSON は「比較が成立しない」ので `UnsupportedSchemaError`、
 * 版が同じで構造が壊れているものは「契約違反」なので `SchemaViolationError` で落とす。
 * 呼び出し側はこの 2 つで exit code を分ける。
 */
export function parseBenchReport(raw: unknown): BenchReport {
  if (!isRecord(raw)) {
    throw new UnsupportedSchemaError("JSON の読み出しに失敗しました");
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new UnsupportedSchemaError(
      `結果 JSON の版が ${String(raw.schemaVersion)} です（この bench が読めるのは ${SCHEMA_VERSION}）。` +
        "測定項目 ID を持つ bench の出力どうしを比較してください",
    );
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    measurements: parseMeasurements(raw.measurements),
    calibration: parseNumbers(raw.calibration, CALIBRATION_KEYS, "calibration") as Calibration,
    scenarioCalibration: parseCalibrations(raw.scenarioCalibration, "scenarioCalibration"),
    results: parseScenarioSummaries(raw.results),
  };
}