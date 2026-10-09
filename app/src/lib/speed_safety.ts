/**
 * 速さ⇔安全スライダーの位置と λ の対応
 * @ref docs/設計/10-速さと安全の切り替え.md
 */

/** スライダーの中央の位置 (λ = 1。各モードの既定と同じ) */
export const SPEED_SAFETY_CENTER = 50;
/** スライダーの右端の位置 (安全優先) */
export const SPEED_SAFETY_MAX = 100;

/** 中央の λ */
const CENTER_LAMBDA = 1;
/** 右端の λ */
const MAX_LAMBDA = 3;

/**
 * スライダーの位置 (0〜100) を λ (0〜3) に直す。
 * 左半分は 0〜1、右半分は 1〜3 を直線でつなぐ。範囲の外は端の値にする
 */
export function sliderToLambda(position: number): number {
  const p = Math.min(Math.max(position, 0), SPEED_SAFETY_MAX);
  const lambda =
    p <= SPEED_SAFETY_CENTER
      ? (CENTER_LAMBDA * p) / SPEED_SAFETY_CENTER
      : CENTER_LAMBDA +
        ((MAX_LAMBDA - CENTER_LAMBDA) * (p - SPEED_SAFETY_CENTER)) /
          (SPEED_SAFETY_MAX - SPEED_SAFETY_CENTER);
  // 小数第 3 位に丸める (0.30000000000000004 のような端数を落とす)
  return Math.round(lambda * 1000) / 1000;
}
