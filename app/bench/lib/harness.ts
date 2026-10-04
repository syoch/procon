/**
 * 計測ハーネスの共通部品。
 *
 * 共有ランナーの CPU は一定ではないので中央値と分散で判断する。
 * シナリオが使う記法は `StageRecorder` 1 つに統一している。
 *
 * @ref README.md#出力の読み方
 */
import { stageNames, type ScenarioName, type StageName } from "../ids";

export type Samples = {
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

export function summarize(samples: number[]): Samples {
  if (samples.length === 0) {
    return { median: NaN, min: NaN, max: NaN, iterations: 0, total: NaN };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    iterations: sorted.length,
    total: sorted.reduce((a, b) => a + b, 0),
  };
}

export type MeasureOptions = {
  /** 暖機。この回数分は結果に含めない */
  warmup: number;
  /** 実測回数 */
  iterations: number;
};

/**
 * `fn` を繰り返し実行して回ごとの所要時間を集める（暖機の回も含める）。
 *
 * `setup` は毎回走らせてから `fn` を測り、その戻り値を `fn` に渡す。
 * データの準備（clone やキャッシュの貼替など）のコストを測定に含めないため、
 * 準備は `setup` に分ける。グラフは破壊的に書き換わるため毎回作り直すこと。
 *
 * 測定項目を持たない校正（`lib/reference.ts`）は、暖機と中央値の取り直しを
 * 呼び出し側で行うため、素のサンプル列を出力する。
 */
export async function sampleRuns<S>(
  setup: () => S | Promise<S>,
  fn: (prepared: S) => void | Promise<void>,
  { warmup, iterations }: MeasureOptions,
): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < warmup + iterations; i++) {
    const prepared = await setup();
    const start = performance.now();
    await fn(prepared);
    samples.push(performance.now() - start);
  }
  return samples;
}

/** 再帰的に deeply copy する。グラフは破壊されるので毎回の clone に必須 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 開始時刻を保持し、呼ぶたびにその時点からの経過時間を返す */
export function stopwatch(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}

/**
 * 1 シナリオ分の測定項目を段ごとに集めるレコーダ。
 *
 * 生成時のシナリオ名から「そのシナリオが測る段」だけを要求するので、
 * `mark("SplitOSMDdata")` のような typo はコンパイルエラーになる。
 * 暖機ぶんは `result()` でまとめて落とす。
 */
export class StageRecorder<S extends ScenarioName = ScenarioName> {
  private readonly samples = new Map<StageName<S>, number[]>();
  private last = performance.now();

  constructor(
    private readonly scenario: S,
    private readonly options: MeasureOptions,
  ) {}

  /**
   * 計測の開始位置を現在時刻に戻す。
   *
   * データの準備（clone など）を測り込まないように、準備のあとに呼ぶ。
   */
  reset(): void {
    this.last = performance.now();
  }

  /** 直前の mark からの経過時間を測定項目に積む */
  mark(stage: StageName<S>): void {
    const now = performance.now();
    const list = this.samples.get(stage);
    if (list === undefined) this.samples.set(stage, [now - this.last]);
    else list.push(now - this.last);
    this.last = now;
  }

  /** 段だけの処理を繰り返し測る。データの準備は `setup` で行う */
  async measure<R>(
    stage: StageName<S>,
    setup: () => R | Promise<R>,
    fn: (prepared: R) => void | Promise<void>,
  ): Promise<void> {
    this.record(stage, await sampleRuns(setup, fn, this.options));
  }

  /** 実行時に段が確定する測定項目に、回ごとの所要時間（暖機の回も含めた列）を積む */
  record(stage: StageName<S>, samples: number[]): void {
    const list = this.samples.get(stage);
    if (list === undefined) this.samples.set(stage, [...samples]);
    else list.push(...samples);
  }

  /**
   * 暖機回ぶんを捨てて中央値を取り直す。
   *
   * レジストリが列挙する段を 1 つも測ってなければ結果を作らない。
   * 段が欠けたまま downstream（JSON 写出・比較）へ進むと、
   * 比較の時点で「その項目が無い」ことしか分からなくなる。
   */
  result(): Record<StageName<S>, Samples> {
    const result = {} as Record<StageName<S>, Samples>;
    const missing: StageName<S>[] = [];
    for (const stage of stageNames(this.scenario)) {
      const kept = this.samples.get(stage)?.slice(this.options.warmup);
      if (kept === undefined || kept.length === 0) {
        missing.push(stage);
        continue;
      }
      result[stage] = summarize(kept);
    }
    if (missing.length > 0) {
      throw new Error(
        `レジストリにある段を測っていません: ${missing.map((stage) => `${this.scenario}/${stage}`).join(", ")}` +
          "（bench/ids.ts の SCENARIO_STAGE_IDS と実装を突き合わせてください）",
      );
    }
    return result;
  }
}