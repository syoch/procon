/**
 * 計測ハーネスの共通部品。
 *
 * 共有ランナー（GitHub Actions など）の CPU は一定ではないので、絶対値ではなく
 * 中央値と分散で判断する。暖機を入れないと JIT の最適化前の回が中央値に混ざり、
 * 数値が安定しないため必ず暖機する。
 *
 * シナリオが使う記法は `StageRecorder` 1 つに統一した。
 * `mark` は 1 パスの中の区切りを、`measure` は 1 段だけの繰り返しを測る。
 * どちらも測定項目 ID（`bench/ids.ts`）を要求するので、ID を間違えるとコンパイルエラーになる。
 */
import { toStageId, type ScenarioName, type StageId, type StageName } from "../ids";

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

/** 測定の条件。CI はこれを base と head で突き合わせ、違うなら比較しない */
export type MeasureConditions = {
  /** 移動モード (car / bicycle / walk / ...) */
  mode: string;
  /**
   * 実測を要求した回数。
   *
   * 測定値側の `Samples.iterations` は暖機ぶんを除いた実測回数で、今は同じ値になる。
   * ここでは「どう測ると決めたか」を条件として明示している。
   */
  iterations: number;
  /** 暖機回数 */
  warmup: number;
  /** フィクスチャ名 */
  fixture: string;
  /** フィクスチャのノード数 */
  fixtureNodeCount: number;
  /** 計測した Node の版 */
  node: string;
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
  { warmup = 5, iterations = 20 }: MeasureOptions = {},
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

/**
 * 集まった測定項目を `[ID, 測定値]` の列に並べ替える。
 *
 * `stages` は「そのシナリオが測る ID だけを持つ」ので `Partial` になる。
 * 未計測の ID は取り除く。ID の型を取り戻すのもここ 1 箇所に閉じ込める。
 */
export function stageEntries(
  stages: Partial<Record<StageId, Samples>>,
): [StageId, Samples][] {
  const entries: [StageId, Samples][] = [];
  for (const [id, samples] of Object.entries(stages)) {
    if (samples === undefined) continue;
    entries.push([id as StageId, samples]);
  }
  return entries;
}

/** 開始時刻を保持し、呼ぶたびにその時点からの経過時間を返す */
export function stopwatch(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}

/**
 * 1 シナリオ分の測定項目を ID ごとに集めるレコーダ。
 *
 * 生成時のシナリオ名から「そのシナリオが測る段」だけを要求するので、
 * `mark("SplitOSMDdata")` のような typo はコンパイルエラーになる。
 * 暖機ぶんは `result()` でまとめて落とす。
 */
export class StageRecorder<S extends ScenarioName = ScenarioName> {
  private readonly samples = new Map<StageId, number[]>();
  private last = performance.now();

  constructor(
    private readonly scenario: S,
    private readonly options: Required<MeasureOptions>,
  ) {}

  /** 直前の mark からの経過時間を測定項目に積む */
  mark(stage: StageName<S>): void {
    const now = performance.now();
    const id = toStageId(this.scenario, stage);
    const list = this.samples.get(id);
    if (list === undefined) this.samples.set(id, [now - this.last]);
    else list.push(now - this.last);
    this.last = now;
  }

  /** 段だけの処理を繰り返し測る。データの準備は `setup` で行う */
  async measure<R>(
    stage: StageName<S>,
    setup: () => R | Promise<R>,
    fn: (prepared: R) => void | Promise<void>,
  ): Promise<void> {
    this.record(
      toStageId(this.scenario, stage),
      await sampleRuns(setup, fn, this.options),
    );
  }

  /** 外部で ID が確定している測定項目に、回ごとの所要時間（暖機の回も含めた列）を積む */
  record(id: StageId, samples: number[]): void {
    const list = this.samples.get(id);
    if (list === undefined) this.samples.set(id, [...samples]);
    else list.push(...samples);
  }

  /** 暖機回ぶんを捨てて中央値を取り直す */
  result(): Partial<Record<StageId, Samples>> {
    const result: Partial<Record<StageId, Samples>> = {};
    for (const [id, all] of this.samples) {
      const kept = all.slice(this.options.warmup);
      if (kept.length === 0) continue;
      result[id] = summarize(kept);
    }
    return result;
  }
}