/**
 * 秒数を「約 12 分」「約 1 時間 5 分」の形にする。
 * 分に丸め、1 分に満たない値は 1 分にする
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `約 ${minutes} 分`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `約 ${hours} 時間` : `約 ${hours} 時間 ${rest} 分`;
}
