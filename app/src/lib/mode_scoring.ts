/**
 * 移動モードごとのスコア (幅員スコア・混在スコア) の定義
 *
 * cost_calculator.js のスコアは全モード共通で、タグが無い道では幅員スコアも混在スコアも highway 種別から推定していた。
 * 特に混在スコア (calculateMixScore) は、歩行者・自転車にとって最も安全な歩行者専用の道 (footway / cycleway / path / steps) を
 * 0.1 (最も危険) と評価していた (switch に無い種別の default 分岐に落ちるため)。徒歩・自転車ではこれが逆になる。
 * また幅員スコアと混在スコアは相関が強く (どちらも幹線ほど高い)、徒歩で重みを幅員だけ・混在だけにしても
 * 長岡駅→見附駅で同じ経路になった (一致率 1.00。完全に同じ値ではなく、15 種のうち 12 種で値は異なる)。
 * ここではモードごとに次のように分ける。
 *
 * - 幅員スコア: 幅が分かる道 (国土地理院の幅員区分で約 9 割) は実際の幅で決める。
 *   境目は国土地理院の幅員区分 (3m / 5.5m / 13m) と、道路構造令の車線の幅に合わせる
 *   (車線の幅 3.0〜3.25m なので 2 車線で 5.5m 以上、1 車線の道路の車道は標準 4m・やむを得ない場合 3m)。
 *   幅が分からない道は従来どおり highway 種別から推定する
 * - 混在スコア: 「何から分かれているのが安全か」をモードごとに変える。
 *   徒歩は車から、自転車は速い車から、車系は歩行者・自転車から分かれているほど高い。
 *   幅が分かる道は「幅員クラス × 歩道の有無」で決める。幅の境目は 3.0m / 5.5m とする
 *   (車両制限令 第5条・第6条の対面通行 5.5m・一方通行 3.0m)。
 *   幅が分からない道は、歩道タグ (sidewalk、付与率は延長の約 0.5%) と highway 種別から推定する
 *
 * 幅員クラスの値は統計ではなく、次の原理から決める。
 * - 幅が広い道ほど歩道が整っている (歩行者・自転車と分離されている)
 * - 狭い道ほど車が遅い (自転車には比較的安全)
 * - 歩道が無い道の値は、下の highway 種別の表の値を目安にする (対応する種別が無い幅員クラスは中間に置く)
 * - 歩道がある道は、歩道が無い道より高い場合がある (同じ値の行もある)
 * pnpm bench:modes で経路を見ながら調整する。@ref app/bench/README.md の「モードごとの経路差の比較」
 *
 * 参考: 道路構造令 第5条 (車線の幅員) https://laws.e-gov.go.jp/law/345CO0000000320
 * 参考: 車両制限令 第5条・第6条 (幅 2.5m の車両の通れる幅) https://laws.e-gov.go.jp/law/336CO0000000265
 */

import { isKnownWidth } from "./road_width";

/** 幅の下限と、その幅以上のときのスコア */
export type WidthScoreStep = {
  /** 幅の下限 [m] */
  minWidth: number;
  /** スコア (0〜1、高いほど安全) */
  score: number;
};

/** 幅員クラスごとの混在スコア。歩道の有無で変える */
export type MixScoreWidthStep = {
  /** 幅の下限 [m] */
  minWidth: number;
  /** 歩道が無い道のスコア (0〜1、高いほど分離されている) */
  withoutSidewalk: number;
  /** 歩道がある道のスコア */
  withSidewalk: number;
};

export type ScoringProfile = {
  /**
   * 幅が分かる道の幅員スコア。幅が minWidth 以上の段のうち、minWidth が最も大きい段のスコアを使う
   * (並び順には依存しない。幅がどの段の minWidth にも届かない場合は、minWidth が最も小さい段のスコア)。
   * undefined のモードは従来どおり (cost_calculator.js の calculateWidthScore)
   */
  widthScoreSteps?: readonly WidthScoreStep[];
  /**
   * 幅が分かる道の混在スコア (幅員クラス × 歩道の有無)。
   * undefined のモードは幅員を使わず、mixScoreByHighway にフォールバックする
   */
  mixScoreByWidth?: readonly MixScoreWidthStep[];
  /**
   * 幅が分からない道の混在スコア (highway 種別ごと)。
   * undefined のモードは従来どおり (cost_calculator.js の calculateMixScore)
   */
  mixScoreByHighway?: Readonly<Record<string, number>>;
  /** mixScoreByHighway に載っていない highway 種別の混在スコア */
  mixScoreDefault?: number;
};

/**
 * 幅員クラスの段から、幅が当てはまる段を選ぶ
 * 幅が minWidth 以上の段のうち minWidth が最も大きい段を返す (並び順には依存しない)。どの段にも届かなければ minWidth が最も小さい段
 */
function matchWidthStep<T extends { minWidth: number }>(steps: readonly T[], width: number): T | undefined {
  let matched: T | undefined;
  let lowest: T | undefined;
  for (const step of steps) {
    if (width >= step.minWidth && (!matched || step.minWidth > matched.minWidth)) matched = step;
    if (!lowest || step.minWidth < lowest.minWidth) lowest = step;
  }
  return matched ?? lowest;
}

/**
 * 幅員スコアを求める。このモードに定義が無いか、幅が分からない場合は undefined (従来の計算に任せる)
 *
 * @param width 区間の平均の幅 [m] (幅不明なら undefined)
 */
export function scoreWidth(profile: ScoringProfile | undefined, width: number | undefined): number | undefined {
  if (!profile?.widthScoreSteps || !isKnownWidth(width)) return undefined;
  return matchWidthStep(profile.widthScoreSteps, width)?.score;
}

/** 歩道タグが歩道の存在を示すか (none / no は歩道なし) */
function hasSidewalk(sidewalk: string | undefined): boolean {
  return !!sidewalk && sidewalk !== "none" && sidewalk !== "no";
}

/**
 * 混在スコアを求める。幅が分かる道は「幅員クラス × 歩道の有無」で決める
 * 幅が分からない道は highway 種別で推定する。歩道があると分かる道と、このモードに highway の定義が無い場合は undefined (従来の計算に任せる)
 *
 * @param sidewalk 区間で最も多い sidewalk タグの値
 * @param highway 区間で最も多い highway 種別
 * @param width 区間の平均の幅 [m] (幅不明なら undefined)
 */
export function scoreMix(profile: ScoringProfile | undefined, sidewalk: string | undefined, highway: string | undefined, width?: number): number | undefined {
  if (profile?.mixScoreByWidth && isKnownWidth(width)) {
    const step = matchWidthStep(profile.mixScoreByWidth, width);
    if (step) return hasSidewalk(sidewalk) ? step.withSidewalk : step.withoutSidewalk;
  }
  if (!profile?.mixScoreByHighway || hasSidewalk(sidewalk)) return undefined;
  return profile.mixScoreByHighway[highway ?? ""] ?? profile.mixScoreDefault;
}

/** 幹線 (国道・主要地方道など)。徒歩には歩道があることが多く、自転車には車が速い道 */
const ARTERIALS = ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"];

/** 種別の一覧に同じスコアを付ける */
function scoreAll(highways: readonly string[], score: number): Record<string, number> {
  return Object.fromEntries(highways.map((h) => [h, score]));
}

/**
 * 徒歩: 幅が広い道ほど高い。
 * 歩道が無い道は highway 種別の表 (幹線 0.7 / tertiary・unclassified 0.5 / 住宅地 0.6) に合わせる。
 * 3m 未満で歩道も無い道は車と同じ空間を共有するため、住宅地より低くする
 */
const WALK_MIX_BY_WIDTH: readonly MixScoreWidthStep[] = [
  { minWidth: 5.5, withoutSidewalk: 0.7, withSidewalk: 0.8 },
  { minWidth: 3, withoutSidewalk: 0.5, withSidewalk: 0.6 },
  { minWidth: 0, withoutSidewalk: 0.4, withSidewalk: 0.6 },
];

/**
 * 自転車: 幅が広い道ほど低い (車が速い)。
 * 歩道が無い道は highway 種別の表 (幹線 0.3 / tertiary 0.4 / unclassified 0.6 / 住宅地 0.7) に合わせる。
 * 自転車は狭い道ほど車が遅いため、歩道が無くても高い
 */
const BICYCLE_MIX_BY_WIDTH: readonly MixScoreWidthStep[] = [
  { minWidth: 5.5, withoutSidewalk: 0.3, withSidewalk: 0.4 },
  { minWidth: 3, withoutSidewalk: 0.6, withSidewalk: 0.6 },
  { minWidth: 0, withoutSidewalk: 0.7, withSidewalk: 0.7 },
];

/**
 * 車・バイク・大型トラック: 歩行者・自転車から分かれているほど高い。
 * 歩道が無い道は highway 種別の表 (幹線 0.8 / 住宅地 0.3) を目安にし、3〜5.5m はその中間の 0.5 とする。
 * 歩道がある道は、両側 0.8 / 片側 0.6 に近づける
 */
const MOTOR_MIX_BY_WIDTH: readonly MixScoreWidthStep[] = [
  { minWidth: 5.5, withoutSidewalk: 0.8, withSidewalk: 0.8 },
  { minWidth: 3, withoutSidewalk: 0.5, withSidewalk: 0.7 },
  { minWidth: 0, withoutSidewalk: 0.3, withSidewalk: 0.6 },
];

/**
 * 徒歩: 車から分かれているほど安全
 * - 歩行者専用の道 (footway / pedestrian / path / steps) が最も高い
 * - 幹線は歩道が整備されていることが多いので、住宅地の道より高くする
 * - 車道幅員は歩行者の安全にあまり関係しないため、幅員スコアは従来どおりとし、重みを小さくする
 */
const WALK_SCORING: ScoringProfile = {
  mixScoreByWidth: WALK_MIX_BY_WIDTH,
  mixScoreByHighway: {
    footway: 1.0, pedestrian: 1.0, path: 1.0, steps: 1.0,
    ...scoreAll(ARTERIALS, 0.7),
    cycleway: 0.6, residential: 0.6, living_street: 0.6,
    tertiary: 0.5, tertiary_link: 0.5, unclassified: 0.5, service: 0.5, track: 0.5,
  },
  mixScoreDefault: 0.3,
};

/**
 * 自転車: 速い車から分かれているほど安全
 * - 自転車道 (cycleway) が最も高く、歩行者用の道 (自転車通行可のとき通れる) が次に高い
 * - 幹線は車が速く、自転車レーンのタグもほぼ無い (cycleway タグの付与率 0.01%) ため低くする
 * - 住宅地の道は車が遅いので比較的高くする
 */
const BICYCLE_SCORING: ScoringProfile = {
  mixScoreByWidth: BICYCLE_MIX_BY_WIDTH,
  mixScoreByHighway: {
    cycleway: 1.0,
    footway: 0.8, pedestrian: 0.8, path: 0.8,
    residential: 0.7, living_street: 0.7,
    unclassified: 0.6, service: 0.6, track: 0.6,
    tertiary: 0.4, tertiary_link: 0.4,
    ...scoreAll(ARTERIALS, 0.3),
  },
  mixScoreDefault: 0.3,
};

/**
 * 車・バイク: すれ違えるか
 * - 3m 未満: 1 台通るのがやっと
 * - 3〜5.5m: 1 車線の道路 (標準 4m)。すれ違いが難しい
 * - 5.5〜13m: 2 車線
 * - 13m 以上: 多車線
 * 混在スコアは歩行者・自転車から分かれているほど高い
 */
const MOTOR_SCORING: ScoringProfile = {
  widthScoreSteps: [
    { minWidth: 13, score: 1.0 },
    { minWidth: 5.5, score: 0.8 },
    { minWidth: 3, score: 0.4 },
    { minWidth: 0, score: 0.1 },
  ],
  mixScoreByWidth: MOTOR_MIX_BY_WIDTH,
};

/**
 * 大型トラック: すれ違いに余裕があるか (車幅 2.5m のため車より厳しくする)
 * 対面通行で 5.5m 未満の道は removeNarrowEdges で除いているので、3〜5.5m は主に一方通行の道
 */
const TRUCK_SCORING: ScoringProfile = {
  widthScoreSteps: [
    { minWidth: 13, score: 1.0 },
    { minWidth: 5.5, score: 0.7 },
    { minWidth: 3, score: 0.2 },
    { minWidth: 0, score: 0.1 },
  ],
  mixScoreByWidth: MOTOR_MIX_BY_WIDTH,
};

export const SCORING_PROFILES = {
  walk: WALK_SCORING,
  bicycle: BICYCLE_SCORING,
  car: MOTOR_SCORING,
  motorcycle: MOTOR_SCORING,
  truck: TRUCK_SCORING,
} as const satisfies Record<string, ScoringProfile>;
