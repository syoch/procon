/**
 * 測定項目 ID のレジストリ。
 *
 * 測定項目の ID は `{シナリオ}/{段}` の形式で、**全 ID をこの 1 箇所に列挙する**。
 * シナリオはこの表だけを参照するので、ID を誤った文字列で書くとコンパイルエラーになる。
 * `mark("SplitOSMDdata")` のような typo は `StageName` の型で弾かれ、
 * レジストリに無い段を 1 つも測り忘れたまま結果を作ることも `StageRecorder.result` が弾く。
 *
 * ID には**上流から渡せず、リビジョンによって変動しうる値だけ**を入れる。
 * モードも実測回数も暖機回数も Node の版もフィクスチャも ID に入れず、
 * CI は `--iterations` / `--warmup` を [`deploy.yml`](../../.github/workflows/deploy.yml) の
 * 1 箇所で base と head に渡して揃える。
 * データ規模（ノード数や辺数）は同じ bbox の OSM キャッシュが保証するので ID にも入れない。
 *
 * したがって ID をリネームすると base から見えなくなり「削除」、head から見えないと「追加」になる。
 */

/** シナリオ -> そのシナリオが測る段 */
export const SCENARIO_STAGE_IDS = {
  /** 1 回の経路探索にかかる CPU の内訳 */
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

/**
 * シナリオ `S` が測る段の名を並べた配列。
 *
 * レジストリの値をジェネリックの型に合わせる変換はここ 1 箇所に閉じる。
 * `StageRecorder.result` が「測り忘れた段」を探すのに使う。
 */
export function stageNames<S extends ScenarioName>(scenario: S): readonly StageName<S>[] {
  return SCENARIO_STAGE_IDS[scenario] as unknown as readonly StageName<S>[];
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