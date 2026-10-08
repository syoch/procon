/**
 * 移動モードごとの想定速度と、所要時間の計算
 *
 * 車系モード (車・バイク・大型トラック) は、経路のコストを距離ではなく所要時間で測る (「速さ優先」を最短時間にするため)。
 * 徒歩・自転車は速度がほぼ一定なので、経路は距離のときと変わらない (所要時間の表示だけに使う)。
 *
 * 想定速度は次の順で決める。
 * 1. maxspeed タグ (道路標識による最高速度。付与率は延長の約 5%、主に幹線)
 * 2. 法定速度 (道路交通法施行令 第11条・第27条)
 *    - 高速道路: 100 km/h (大型トラックは 90 km/h。2024 年 4 月 1 日から)
 *    - 中央線・車両通行帯などがある一般道路: 60 km/h
 *    - それ以外の一般道路 (生活道路): 30 km/h (2026 年 9 月 1 日から)
 *
 * 中央線の有無はタグからほとんど分からないので、次のどれかに当てはまれば「中央線あり」とみなす (推定)。
 * - 幹線 (trunk / primary / secondary / tertiary とそのランプ)
 * - lanes タグが 2 以上 (付与率は延長の約 10%)
 * - 国土地理院の幅が 5.5m 以上 (2 車線分の幅。中央線が引かれているとは限らない)
 *
 * 法定速度は上限であって平均の速さではない (信号・渋滞で実際はもっと遅い)。ここでは道の種類による速さの違いの目安として使う。
 *
 * 参考:
 * - 警察庁「生活道路における自動車の法定速度が引き下げられます」(道路交通法施行令 第11条)
 * - 大型トラックの高速道路の最高速度 90 km/h (2024-04-01、トレーラーは対象外)
 */

import { isKnownWidth } from "./road_width";

export type SpeedProfile =
  /** 速度が一定のモード (徒歩・自転車)。経路のコストは距離のまま */
  | { kind: "constant"; kmh: number }
  /** 車系モード。道の種類・タグから速度を決め、経路のコストを所要時間で測る */
  | { kind: "motor"; motorwayKmh: number };

/** 中央線などがある一般道路の法定速度 [km/h] (道路交通法施行令 第11条第1号) */
export const CENTER_LINE_KMH = 60;
/** 中央線などが無い一般道路の法定速度 [km/h] (道路交通法施行令 第11条第2号、2026-09-01 施行) */
export const NO_CENTER_LINE_KMH = 30;
/** 高速道路の出入口 (*_link のうち motorway_link) の想定速度 [km/h] (仮の値。出典なし) */
export const MOTORWAY_LINK_KMH = 40;
/**
 * コストを「時間換算の距離」にするときの基準の速度 [km/h]
 * 区間の距離 × (基準の速度 / 想定速度) をコストにする。60 km/h の道は距離のまま、30 km/h の道は 2 倍になる。
 * 単位を距離 [m] のままにしておくことで、交差点の仮想エッジ (10m) などの既存の値とそろう
 */
export const REFERENCE_KMH = CENTER_LINE_KMH;

/** 中央線があるとみなす幅 [m] (国土地理院の幅員区分の 5.5m 以上 = 2 車線分) */
const CENTER_LINE_MIN_WIDTH_M = 5.5;

/** 中央線があるとみなす幹線 */
const ARTERIALS = new Set([
  "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link",
]);

/** 速度の判定に使う区間の情報 */
export type SpeedSegment = {
  highway: string;
  width: number | null;
  maxspeed?: number | null;
  lanes?: number | null;
};

/**
 * maxspeed タグの値を km/h に直す (読めない値は undefined)
 * 例: "50" → 50、"50 km/h" → 50、"30 mph" → 48.3、"none" / "signals" / "JP:urban" → undefined
 */
export function parseMaxspeed(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(km\/h|kmh|kph|mph)?$/i);
  if (!match) return undefined;
  const speed = Number(match[1]);
  if (!(speed > 0)) return undefined;
  return match[2]?.toLowerCase() === "mph" ? speed * 1.609344 : speed;
}

/** lanes タグの値を数に直す (読めない値は undefined) */
export function parseLanes(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const lanes = Number(value.trim());
  return Number.isInteger(lanes) && lanes > 0 ? lanes : undefined;
}

/** 中央線などがある道とみなすか (推定) */
export function hasCenterLine(segment: SpeedSegment): boolean {
  if (ARTERIALS.has(segment.highway)) return true;
  if ((segment.lanes ?? 0) >= 2) return true;
  return isKnownWidth(segment.width) && segment.width >= CENTER_LINE_MIN_WIDTH_M;
}

/** 区間の想定速度 [km/h] */
export function segmentSpeedKmh(profile: SpeedProfile, segment: SpeedSegment): number {
  if (profile.kind === "constant") return profile.kmh;
  if (segment.highway === "motorway") {
    // 標識の速度があっても、車種の法定速度 (大型トラック 90 km/h) は超えない
    return Math.min(segment.maxspeed ?? profile.motorwayKmh, profile.motorwayKmh);
  }
  if (segment.highway === "motorway_link") {
    // ランプが本線より速くならないよう、本線と同じ上限を掛ける
    return Math.min(segment.maxspeed ?? MOTORWAY_LINK_KMH, profile.motorwayKmh);
  }
  if (segment.maxspeed) return segment.maxspeed;
  return hasCenterLine(segment) ? CENTER_LINE_KMH : NO_CENTER_LINE_KMH;
}

/**
 * 区間の距離に掛ける倍率 (時間換算の距離にする)。速度が一定のモードは 1 (距離のまま)
 */
export function travelTimeFactor(profile: SpeedProfile | undefined, segment: SpeedSegment): number {
  if (!profile || profile.kind === "constant") return 1;
  return REFERENCE_KMH / segmentSpeedKmh(profile, segment);
}

/**
 * 区間の一覧の所要時間 [秒]
 * (交差点の待ち時間・信号・渋滞は含まない)
 */
export function travelTimeSeconds(
  profile: SpeedProfile,
  segments: Iterable<SpeedSegment & { distance: number }>,
): number {
  let seconds = 0;
  for (const segment of segments) {
    seconds += segment.distance / (segmentSpeedKmh(profile, segment) / 3.6);
  }
  return seconds;
}
