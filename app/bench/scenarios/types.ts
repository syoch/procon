import type { ModeId } from "../../src/lib/mode_profiles";
import type { ScenarioName, StageName } from "../ids";
import type { Samples } from "../lib/harness";

export type ScenarioContext = {
  /** 移動モード。モードを使うシナリオには必ず渡る */
  mode?: ModeId;
  /** 実測回数 */
  iterations: number;
  /** 暖機回数 */
  warmup: number;
};

export type ScenarioResult<S extends ScenarioName = ScenarioName> = {
  scenario: S;
  /** 段ごとの実測値。キーは測定項目 ID の `{段}` の部分 */
  stages: Record<StageName<S>, Samples>;
  /** 各段の中央値を足したもの [ms] */
  total: number;
  /** シナリオごとの補足情報（データ規模・グラフ規模など） */
  info?: Record<string, string | number | boolean>;
};

export type Scenario<S extends ScenarioName = ScenarioName> = {
  name: S;
  description: string;
  /** モードごとに測るなら列挙する。1 回の実行で列挙したモードをすべて測る */
  modes?: readonly ModeId[];
  run(context: ScenarioContext): ScenarioResult<S> | Promise<ScenarioResult<S>>;
};

/** 3 つのシナリオのどれでも受け取れるシナリオ。run.ts はこれの配列に並べる */
export type AnyScenario = { [S in ScenarioName]: Scenario<S> }[ScenarioName];

/** 3 つのシナリオのどれでも受け取れる結果。run.ts はこれの配列に貯める */
export type AnyScenarioResult = { [S in ScenarioName]: ScenarioResult<S> }[ScenarioName];