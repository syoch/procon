/**
 * 測定項目 ID のレジストリ。
 *
 * 測定項目の ID は `{シナリオ}/{段}` の形式で、**全 ID をこの 1 箇所に列挙する**。
 * シナリオはこの表だけを参照するので、ID を誤った文字列で書くとコンパイルエラーになる。
 * 現状の `Record<string, Samples>` では `mark("SplitOSMDdata")` のような typo を
 * コンパイル時に検出できず、比較時に「追加」として現れるまで気づけない。
 *
 * ID は「何を、どの条件で測ったか」の識別子であり、CI はこの ID で base と head を突き合わせる。
 * したがって**測定対象や負荷が変わるときは ID を変える**。
 * ID をリネームすると base から見えなくなるので「削除 + 追加」として扱われ、比較されない。
 */

/** シナリオ -> そのシナリオが測る段 */
export const SCENARIO_STAGE_IDS = {
  /** 1 回の経路探索にかかる CPU の内訳 */
  pipeline: [
    /** clone() の準備時間。区切りとして測って結果から取り除く */
    "__start__",
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

export type ScenarioName = keyof typeof SCENARIO_STAGE_IDS;

/** `{シナリオ}/{段}` を ID の型に組み立てる */
type JoinStageIds<T extends Record<string, readonly string[]>> = {
  [K in keyof T & string]: `${K}/${T[K][number]}`;
}[keyof T & string];

/** 測定項目 ID。レジストリに無い文字列は型として存在しない */
export type StageId = JoinStageIds<typeof SCENARIO_STAGE_IDS>;

/** シナリオ `S` が測る段の名だけを並べた型 */
type StageNameOf<S extends ScenarioName, Id extends StageId = StageId> = Id extends `${S}/${infer Name}`
  ? Name
  : never;

/** シナリオ `S` のレコーダーに渡せる段名。`mark("SplitOSMData")` の typo はここで弾かれる */
export type StageName<S extends ScenarioName> = StageNameOf<S>;

/** レジストリが列挙している ID 全体 */
const STAGE_ID_SET = new Set<string>(
  Object.entries(SCENARIO_STAGE_IDS).flatMap(([scenario, stages]) =>
    stages.map((stage) => `${scenario}/${stage}`),
  ),
);

/** 文字列がレジストリにある ID か */
export function isStageId(value: string): value is StageId {
  return STAGE_ID_SET.has(value);
}

/**
 * シナリオ名と段名を ID に綴り合わせる。
 *
 * 実行時の名前（`RequestContext` の計測名は文字列で届く）から ID を作るところでだけ使う。
 * レジストリに無い名前を渡すと、JSON を作る前に原因が分かる形で落ちる。
 */
export function toStageId(scenario: ScenarioName, name: string): StageId {
  const id = `${scenario}/${name}`;
  if (!isStageId(id)) {
    throw new Error(
      `レジストリに無い測定項目 ID です: ${id}（ID は bench/ids.ts の SCENARIO_STAGE_IDS に列挙してください）`,
    );
  }
  return id;
}
