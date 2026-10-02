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
  scenario: string;
  /** 段ごとの実測値 */
  stages: Record<string, Samples>;
  /** 各段の中央値を足したもの [ms] */
  total: number;
  /** シナリオごとの補足情報（データ規模・グラフ規模など） */
  info?: Record<string, string | number | boolean>;
};

export type Scenario = {
  name: string;
  description: string;
  defaultIterations: number;
  run(context: ScenarioContext): ScenarioResult | Promise<ScenarioResult>;
};

/**
 * 1 パスの中で段ごとに時間を取るためのレコーダ。
 * `measure`（暖機後に 1 段だけ測る）と 달리、素通し 1 回ぶんの内訳をまとめて取れる。
 */
export class StageRecorder {
  private readonly samples = new Map<string, number[]>();
  private last = performance.now();

  constructor(private readonly warmup: number) {}

  /** 直前の mark からの経過時間を label に積む */
  mark(label: string) {
    const now = performance.now();
    const list = this.samples.get(label);
    if (list === undefined) this.samples.set(label, [now - this.last]);
    else list.push(now - this.last);
    this.last = now;
  }

  /** 暖機回ぶんを捨てて中央値を取り直す */
  result(): Record<string, Samples> {
    const result: Record<string, Samples> = {};
    for (const [label, all] of this.samples) {
      const kept = all.slice(this.warmup);
      if (kept.length === 0) continue;
      const sorted = [...kept].sort((a, b) => a - b);
      result[label] = {
        median: sorted[Math.floor(sorted.length / 2)],
        min: sorted[0],
        max: sorted[sorted.length - 1],
        iterations: kept.length,
        total: kept.reduce((a, b) => a + b, 0),
      };
    }
    return result;
  }
}
