import { describe, expect, test } from "vitest";
import { measureCalibration, measureCalibrationOnce } from "../../bench/lib/reference";

/**
 * 校正の暖機のテスト。
 *
 * 校正はプロセス起動直後の値を含んでいるので、「最初の 1 回だけ長く測る」という
 * 仕様が守られていることだけを確認する。実際の時間には絶対値がないので、
 * 測定回数と仕事量の検算値しか見ない。
 *
 * 暖機はプロセス単位の状態なので、順序を固定した 1 本のテストにまとめている。
 * ループ回数は縮めてあるので、実行時間は数十 ms にとどまる。
 */

const SMALL = { iterations: 24_000 };

describe("校正の暖機", () => {
  test("最初の 1 回だけ長く測り、2 回目以降は 1 回分に戻る", async () => {
    const single = await measureCalibrationOnce(SMALL);
    const first = await measureCalibration(SMALL);
    const second = await measureCalibration(SMALL);

    // 集めるのは 5 回分（破棄した先頭は含めない）
    expect(first.iterations).toBe(single.iterations * 5);
    expect(second.iterations).toBe(single.iterations);
    // 仕事量の検算値は決定的なので、どこを採っても同じ
    expect(first.work).toBe(single.work);
    expect(second.work).toBe(single.work);
  });
});
