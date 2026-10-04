/**
 * 結果 JSON のスキーマ。
 *
 * 作る側（`run.ts`）と取り出す側（`compare.mjs`）が同じスキーマを使う。
 * 型は `z.infer` で取り出すので、検証と型が同じ定義から生まれる。
 *
 * 版の違う JSON は `UnsupportedSchemaError`、構造が契約を守っていないものは
 * `SchemaViolationError` で落とす。
 * 呼び出し側は前者を比較不成立（exit 2）、後者を契約違反（exit 1）として扱う。
 *
 * @ref README.md#結果-json-のスキーマ
 */
import { z } from "zod";

/** 結果 JSON の版。構造を変えたらこれを変え、スキーマも同時に更新する */
export const SCHEMA_VERSION = 1;

/** 1 件の測定値 */
export const measurementSchema = z.object({
  /** 実測した回の中央値 [ms] */
  median: z.number(),
  /** 最小値 [ms] */
  min: z.number(),
  /** 最大値 [ms] */
  max: z.number(),
  /** 測定回数（暖機した回を除く） */
  iterations: z.number(),
  /** 実測した総時間 [ms] */
  total: z.number(),
});

/** 校正の測定値。アプリに依存しない固定仕事量の所要時間と、仕事量の検算値 */
export const calibrationSchema = measurementSchema.extend({
  /** 仕事量の検算値。同じ Node で走らせれば必ず同じ値になる */
  work: z.number(),
});

/** シナリオごとの補足。比較には使わないので自由な値を保持する */
const scenarioSummarySchema = z.object({
  scenario: z.string(),
  /** 各段の中央値を足したもの [ms] */
  total: z.number(),
  info: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** bench が書き出す結果 JSON */
export const benchReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** 測定項目 ID -> 測定値 */
  measurements: z.record(z.string(), measurementSchema),
  /** 開始時の校正 */
  calibration: calibrationSchema,
  /** シナリオ名 -> そのシナリオを走らせる直前に測った校正 */
  scenarioCalibration: z.record(z.string(), calibrationSchema),
  /** シナリオごとの補足 */
  results: z.array(scenarioSummarySchema),
});

export type Measurement = z.infer<typeof measurementSchema>;
export type Calibration = z.infer<typeof calibrationSchema>;
export type ScenarioSummary = z.infer<typeof scenarioSummarySchema>;
export type BenchReport = z.infer<typeof benchReportSchema>;

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

/**
 * 結果 JSON を読んで検証する。
 *
 * 測定項目 ID はキーのまま扱う。
 * ID の形は bench 側の約束（`{シナリオ}[/{モード}]/{段}`）で、ここでは見ない。
 *
 * 版の違う JSON は `UnsupportedSchemaError`、版が同じで構造が壊れているものは
 * `SchemaViolationError` で落とす。呼び出し側はこの 2 つで exit code を分ける。
 */
export function parseBenchReport(raw: unknown): BenchReport {
  const parsed = benchReportSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (isWrongVersion(raw)) {
    throw new UnsupportedSchemaError(
      `結果 JSON の版が ${String((raw as { schemaVersion: unknown }).schemaVersion)} です` +
        `（この bench が読めるのは ${SCHEMA_VERSION}）。` +
        "測定項目 ID を持つ bench の出力どうしを比較してください",
    );
  }
  throw new SchemaViolationError(
    parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" / "),
  );
}

/** 版フィールドだけ先に見て、版の違う JSON を構造の違反と区別する */
function isWrongVersion(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return true;
  const { schemaVersion } = raw as { schemaVersion?: unknown };
  return schemaVersion !== SCHEMA_VERSION;
}