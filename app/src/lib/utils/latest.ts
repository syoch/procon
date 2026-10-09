/**
 * 続けて始めた非同期処理のうち、最後に始めたものを見分ける。
 * begin() が返す関数は、次の begin() が呼ばれるまで true を返す
 */
export type LatestGuard = {
  /** 新しい処理を始める。返る関数で「まだ最後の処理か」を確かめる */
  begin(): () => boolean;
};

export function createLatestGuard(): LatestGuard {
  let seq = 0;
  return {
    begin() {
      const mine = ++seq;
      return () => mine === seq;
    },
  };
}
