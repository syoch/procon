import type { ModeId } from "../../src/lib/mode_rules";
import type { Samples } from "../lib/harness";

export type ScenarioContext = {
  /** 実測回数 */
  iterations: number;
  /** 暖機回数 */
  warmup: number;
};

export type ScenarioResult = {
  /** シナリオ名 */
  scenario: string;
  /** モードを使うシナリオは測定したモードを持つ */
  mode?: ModeId;
  /** 段ごとの実測値。キーは測定項目 ID の `{段}` の部分 */
  stages: Record<string, Samples>;
  /** 各段の中央値を足したもの [ms] */
  total: number;
  /** シナリオごとの補足情報（データ規模・グラフ規模など） */
  info?: Record<string, string | number | boolean>;
};

export type Scenario = {
  name: string;
  description: string;
  /** モードごとに測るシナリオはこの値を持つ */
  mode?: ModeId;
  run(context: ScenarioContext): ScenarioResult | Promise<ScenarioResult>;
};