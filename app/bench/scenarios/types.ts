import type { ScenarioName, StageId } from "../ids";
import type { Samples } from "../lib/harness";

export type ScenarioContext = {
  /** 移動モード (car / bicycle / walk / ...) */
  mode: string;
  /** 実測回数 */
  iterations: number;
  /** 暖機回数 */
  warmup: number;
};

export type ScenarioResult = {
  scenario: ScenarioName;
  /** 段ごとの実測値。キーは測定項目 ID */
  stages: Partial<Record<StageId, Samples>>;
  /** 各段の中央値を足したもの [ms] */
  total: number;
  /** シナリオごとの補足情報（データ規模・グラフ規模など） */
  info?: Record<string, string | number | boolean>;
};

export type Scenario = {
  name: ScenarioName;
  description: string;
  defaultIterations: number;
  run(context: ScenarioContext): ScenarioResult | Promise<ScenarioResult>;
};
