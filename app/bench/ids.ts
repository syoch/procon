/**
 * 測定項目 ID のレジストリ。
 *
 * 段の全 ID を `SCENARIO_STAGE_IDS` に 1 箇所で列挙する。
 * ID の形は `{シナリオ}/{段}` と、モードを使うシナリオの `{シナリオ}/{モード}/{段}` の 2 通り。
 * ID に入れる値と理由は [`README.md`](./README.md#測定項目-id) に書いてある。
 *
 * ここを直すと StageId の型が変わり、レジストリに無い ID は `stageId()` が落とす。
 */
import { MODE_IDS, type ModeId } from "../src/lib/mode_profiles";

/** シナリオ -> そのシナリオが測る段 */
export const SCENARIO_STAGE_IDS = {
  /** 1 回の経路探索にかかる CPU の内訳。モードごとに測る */
  pipeline: [
    "divideBoundary",
    "simplifyBoundaries",
    "SplitOSMData",
    "mergeOSMData",
    "trimOSMData",
    "trimOSMDataByMode",
    "transformOSMMapToOSMGraph",
    "CrossConvert",
    "fold2DegreeEdges",
    "largestComponentEdges",
    "transientSplit",
    "pathFind",
    "collectRoadJunctions",
    "detectSharpTurnsOnPath",
    "measureSegmentsWidthCoverage",
  ],
  /** `SplitOSMData` 単体 */
  split: ["SplitOSMData"],
  /** ファイルキャッシュが全ヒットした状態での `requireOSMData` と、本番ログの内訳 */
  "cache-read": [
    "requireOSMData",
    "RequestContext.divide",
    "RequestContext.cache",
    "RequestContext.merge",
    "RequestContext.trim",
  ],
} as const;

/** モードを使うシナリオ。ID は `{シナリオ}/{モード}/{段}` になる */
const USES_MODE = {
  pipeline: true,
  split: false,
  "cache-read": false,
} as const satisfies Record<keyof typeof SCENARIO_STAGE_IDS, boolean>;

export type ScenarioName = keyof typeof SCENARIO_STAGE_IDS;

/** シナリオ `S` が測る段の名を並べた型 */
type StageNameOf<S extends ScenarioName> = (typeof SCENARIO_STAGE_IDS)[S][number];

/** シナリオ `S` のレコーダーに渡せる段名。`mark("SplitOSMData")` の typo はここで弾かれる */
export type StageName<S extends ScenarioName> = StageNameOf<S>;

/** シナリオ `S` の測定項目 ID。モードを使うシナリオはモードを挟む */
type StageIdOf<S extends ScenarioName> = (typeof USES_MODE)[S] extends true
  ? `${S}/${ModeId}/${StageNameOf<S>}`
  : `${S}/${StageNameOf<S>}`;

/** 測定項目 ID。レジストリに無い文字列は型として存在しない */
export type StageId = { [S in ScenarioName]: StageIdOf<S> }[ScenarioName];

/**
 * シナリオ `S` が測る段の名を並べた配列。
 *
 * レジストリの値をジェネリックの型に合わせる変換はここ 1 箇所に閉じる。
 * `StageRecorder.result` が「測り忘れた段」を探すのに使う。
 */
export function stageNames<S extends ScenarioName>(scenario: S): readonly StageName<S>[] {
  return SCENARIO_STAGE_IDS[scenario] as unknown as readonly StageName<S>[];
}

/** レジストリが列挙している ID 全体 */
const STAGE_ID_SET = new Set<string>(
  Object.entries(SCENARIO_STAGE_IDS).flatMap(([scenario, stages]) => {
    const modes: (ModeId | "")[] = USES_MODE[scenario as ScenarioName] ? MODE_IDS : [""];
    return modes.flatMap((mode) =>
      stages.map((stage) => (mode === "" ? `${scenario}/${stage}` : `${scenario}/${mode}/${stage}`)),
    );
  }),
);

/** 文字列がレジストリにある ID か */
export function isStageId(value: string): value is StageId {
  return STAGE_ID_SET.has(value);
}

/**
 * シナリオと段から測定項目 ID を組み立てる。
 *
 * モードを使うシナリオでは `mode` が ID に入る（入れ忘れるとレジストリに無い ID として落ちる）。
 * 段の型はシナリオごとに違うので、ここだけは緩い引数にして検証で落とす。
 */
export function stageId(scenario: string, stage: string, mode?: string): StageId {
  const id = mode === undefined ? `${scenario}/${stage}` : `${scenario}/${mode}/${stage}`;
  if (!isStageId(id)) {
    throw new Error(
      `レジストリに無い測定項目 ID です: ${id}（ID は bench/ids.ts の SCENARIO_STAGE_IDS に列挙してください）`,
    );
  }
  return id;
}

/**
 * 実行時に届いた段名を、型付きの段名に変換する。
 *
 * `RequestContext` の計測名は文字列で届くので、この関数を通すまで型にならない。
 * レジストリに無い名前はそのまま落とすので、本番側に計測が追加されたら
 * 結果 JSON を作る前に原因が分かる形で落ちる。
 */
export function toStageName<S extends ScenarioName>(scenario: S, name: string): StageName<S> {
  if (!(SCENARIO_STAGE_IDS[scenario] as readonly string[]).includes(name)) {
    throw new Error(
      `レジストリに無い測定項目 ID です: ${scenario}/${name}` +
        "（ID は bench/ids.ts の SCENARIO_STAGE_IDS に列挙してください）",
    );
  }
  return name as StageName<S>;
}