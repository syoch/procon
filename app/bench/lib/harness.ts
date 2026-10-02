/**
 * 計測ハーネスの共通部品。
 *
 * 共有ランナー（GitHub Actions など）の CPU は一定ではないので、絶対値ではなく
 * 中央値と分散で判断する。暖機を入れないと JIT の最適化前の回が中央値に混ざり、
 * 数値が安定しないため必ず暖機する。
 */

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
  warmup?: number;
  /** 実測回数 */
  iterations?: number;
};

/**
 * `fn` を繰り返し実行して中央値を測る。
 *
 * `setup` は毎回走らせてから `fn` を測り、その戻り値を `fn` に渡す。
 * データの準備（clone やキャッシュの貼替など）のコストを測定に含めないため、
 * 準備は `setup` に分ける。グラフは破壊的に書き換わるため毎回作り直すこと。
 */
export async function measure<S>(
  setup: () => S | Promise<S>,
  fn: (prepared: S) => void | Promise<void>,
  { warmup = 5, iterations = 20 }: MeasureOptions = {},
): Promise<Samples> {
  for (let i = 0; i < warmup; i++) {
    await fn(await setup());
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const prepared = await setup();
    const start = performance.now();
    await fn(prepared);
    samples.push(performance.now() - start);
  }
  return summarize(samples);
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
