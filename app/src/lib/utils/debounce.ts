/**
 * 最後の呼び出しから waitMs 静まるまで fn を実行しない関数を作る。
 * 連続呼び出しでは待ち時間を測り直す。
 */
export type Debounced = {
  (): void;
  /** 未実行の呼び出しを捨てる */
  cancel(): void;
};

export function debounce(fn: () => void, waitMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const call = (() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, waitMs);
  }) as Debounced;

  call.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return call;
}
