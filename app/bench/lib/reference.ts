import { sampleRuns, summarize, type Samples } from "./harness";

/**
 * 校正ワークロード: 2 回の計測の間で「機械の速度」が変わっていないことを確かめる。
 *
 * アプリのコードに一切依存しない固定の整数演算を用意し、base と head の計測の
 * 直前に 1 回ずつ測る。使う仕事量は常に同じなので、所要時間だけが機械の速度を
 * 反映する。2 つの時間が想定の範囲を外れていれば、段が実際に遅くなったのではなく
 * 2 回の計測が別々の状態で取られた、つまり比較が成立していない、とみなせる。
 *
 * 校正に使う仕事は次の性質を満たす必要がある。どれか 1 つ崩れると、測る物が
 * 「機械の速度」でなくなる:
 *
 * - 整数演算だけを使う。浮動小数点の演算と除算は実行時間が一定にならず、
 *   実装が違えば速さも変わる。`Math` も実装ごとに速さが違うので使わない。
 * - 少量の固定長テーブル以外は確保しない。大きなオブジェクトの確保を混ぜると、
 *   校正ではなくゴミ集めの話を測ることになる。
 * - 分岐は事実上取られないものだけ置く。データによって予測が外れると、実行時間が
 *   揺れて数パーセントの判定も壊れる。
 * - 仕事量を時間から逆算しない。逆算すると遅い機械ほど仕事量が減って常に同じ時間に
 *   なり、比較そのものが消える。2.5 倍遅くなっても同じ回数だけ回す。
 * - 戻り値を必ず外へ出す。捨てるだけだと最適化で丸ごと消される。
 */

/** テーブルは 4KB 程度に収めて、メモリの待ち時間が混ざらないようにする */
const TABLE_SIZE = 1024;
const TABLE_MASK = TABLE_SIZE - 1;

/**
 * 1 回あたりのループ回数。
 *
 * 開発機（Ryzen 5 5625U）では 1 回 69ms ほど。共有ランナーが 2.5 倍遅くても
 * 170ms 程度で 300ms には届かないので、CI の 2 回実行を合わせても数秒で済む。
 */
const ITERATIONS = 24_000_000;

/** 1 回あたりのループ回数を差し替えるための口。ベンチ自体は固定値を使う */
export type CalibrationOptions = {
  iterations?: number;
};

/** 最初の数回は最適化前なので捨てる */
const WARMUP = 3;

/** 実測回数。中央値を使うので奇数にする */
const SAMPLES = 7;

/**
 * プロセス内で最初に校正を測るときの採用サンプル数。
 *
 * ランナーのコールドコスト（全速になるまでの時間、ページキャッシュの読み込み、
 * Turbo の立ち上がり）は 1 回では抜けきらない。
 * 先頭の 1 回を捨てて、さらに 5 回測るとサンプルの半分以上が落ち着いた値になる。
 *
 * コストは 60 kernel run 分（実測 6 倍）なので、対話的な利用では重く感じる。
 * CI の bench ジョブでは base と head の合計で +7.6s にとどまる。
 */
const AGGREGATE_SAMPLES = 5;

/**
 * プロセス内で校正を測ったか。最初の 1 回だけ長く測るために使う。
 *
 * 返り値は呼び出し順で変わる。最初の 1 回は `iterations` が
 * `SAMPLES * AGGREGATE_SAMPLES`（35）、2 回目以降は `SAMPLES`（7）になる。
 * 独立した 1 回測定が欲しいときは `measureCalibrationOnce()` を明示して呼ぶ。
 *
 * フラグを立てる前に測定が完了するので、並行して呼んでも
 * 最初に完了した側だけが長測定になる。校正は直列 await なので競合しない。
 */
let warmed = false;

const table = new Int32Array(TABLE_SIZE);

/** 状態を初期値に戻す。毎回同じ状態から始めると回ごとの仕事量が揃い、中央値が読みやすい */
function resetTable(): void {
  for (let i = 0; i < TABLE_SIZE; i++) {
    // 乗算で散らした値を入れておく。0 だと次の演算が縮退する
    table[i] = ((i * 2654435761) | 0) || 1;
  }
}

/**
 * 仕事量が固定されている整数演算。
 *
 * 状態を加算・減算・ビット反転で逐次的に混ぜている。同じ速さの機械なら必ず同じ個数の
 * 命令を通し、同じ個数だけ値を動かす。戻り値は呼び出し側が出すので省略しない。
 */
function runKernel(iterations: number): number {
  let a = table[0];
  let b = table[1];
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const slot = i & TABLE_MASK;
    const v = table[slot];
    // 逐次依存の連鎖。各段が前の段の値を受け取るので並列化も枝分かれもしない
    a = (a ^ (a << 13)) | 0;
    a = (a ^ (a >>> 17)) | 0;
    a = (a ^ (a << 5)) | 0;
    a = (a + v) | 0;
    table[slot] = a;
    b = (b + a) | 0;
    sum = (sum ^ (a - b)) | 0;
    // 事実上取られない分岐。命令の混合に 1 つだけ足す。取られても結果は変わらない
    if (a === 0) sum = (sum + 1) | 0;
  }
  return sum;
}

export type Calibration = Samples & {
  /**
   * 仕事量そのものの仕事量の検算値。
   *
   * 同じ値なら「同じ仕事をした」ということで、この値が base と head で違うときは
   * 校正が成立していない（Node の版が違う、テーブルが壊れた等）。
   */
  work: number;
};

/**
 * 校正を 1 回測る。
 *
 * アプリ本体の実測回数（`--iterations`）に追随させると
 * base と head で仕事量が揃わないので固定値にする。
 * 校正は測定項目 ID を持たないので `StageRecorder` を通さず、素のサンプル列を
 * 暖機ぶん捨てて中央値に落とす。
 *
 * プロセス内で最初の 1 回だけ長く測る仕掛けは `measureCalibration()` 側に閉じている。
 * この関数自身は常に 1 回分だけ測るので、テストからも呼べる。
 *
 * `iterations` はテスト用にループ回数を縮めるためだけに開けている。
 * ベンチの計測では常に固定値を使う。
 */
export async function measureCalibrationOnce(options: CalibrationOptions = {}): Promise<Calibration> {
  const iterations = options.iterations ?? ITERATIONS;
  let work = 0;
  const runs = await sampleRuns(
    resetTable,
    () => {
      work = runKernel(iterations);
    },
    { warmup: WARMUP, iterations: SAMPLES },
  );
  return { ...summarize(runs.slice(WARMUP)), work };
}

/**
 * 校正を測る。
 *
 * プロセス内で最初の 1 回だけは、コールドコストを避けて長く測る。
 * 1 回捨ててから `AGGREGATE_SAMPLES` 回測り、中央値にまとめる。
 * 2 回目以降は 1 回だけで測る（その時点までは既に十分動いている）。
 *
 * 集めるのは「機械の速度」であって「最初は何も動いていない状態」ではないので、
 * 最初の 1 回をそのまま採用すると base と head の校正が実行順でずれてしまう。
 *
 * 返り値の `iterations` は呼び出し順で変わる（最初は 35、以降は 7）。
 * 1 回分の独立した測定が欲しいときは `measureCalibrationOnce()` を使う。
 *
 * @ref docs/設計/09-bench測定と比較.md
 */
export async function measureCalibration(options: CalibrationOptions = {}): Promise<Calibration> {
  if (warmed) return measureCalibrationOnce(options);
  warmed = true;
  await measureCalibrationOnce(options);
  const samples: Calibration[] = [];
  for (let i = 0; i < AGGREGATE_SAMPLES; i++) {
    samples.push(await measureCalibrationOnce(options));
  }
  // 仕事量の検算値は決定的なので回が違っても同じ値になる。どれを採用しても同じ。
  const medians = samples.map((s) => s.median).sort((a, b) => a - b);
  return {
    median: medians[Math.floor(medians.length / 2)],
    min: Math.min(...samples.map((s) => s.min)),
    max: Math.max(...samples.map((s) => s.max)),
    iterations: samples.reduce((sum, s) => sum + s.iterations, 0),
    total: samples.reduce((sum, s) => sum + s.total, 0),
    work: samples[0].work,
  };
}
