/**
 * 移動モード (徒歩・自転車・車・バイク・大型トラック) ごとの既定パラメータ
 *
 * モードごとの道の種別・一方通行・急カーブの基準とスコアの重み (データ) をここで持つ。
 * スコアの重み (ソフトな好み) は defaultParameters で持ち、探索時に上書きもできる。
 *
 * 通行できるかどうかの判定 (ハード制約) は mode_rules.ts が持つ。
 */

import type { ModeId, ModeProfile } from "./mode_rules";
import { SCORING_PROFILES } from "./mode_scoring";

/**
 * 自動車が通る一般的な道路
 * (track / service は幅が分からないため、車系モードでは条件付き・割高で別に扱う)
 */
const MOTOR_ROADS = [
  "motorway", "motorway_link",
  "trunk", "trunk_link",
  "primary", "primary_link",
  "secondary", "secondary_link",
  "tertiary", "tertiary_link",
  "unclassified", "residential", "living_street",
];

/** 高速道路 (歩行者・自転車は通行不可) */
const MOTORWAYS = ["motorway", "motorway_link"];

const withoutMotorways = MOTOR_ROADS.filter((h) => !MOTORWAYS.includes(h));

/** 車・バイクで、幅が分からない道を割高にする倍率 (仮の値) */
const MOTOR_COST_FACTOR: Readonly<Record<string, number>> = { service: 2, track: 2 };

export const MODE_PROFILES: Record<ModeId, ModeProfile> = {
  walk: {
    id: "walk",
    name: "徒歩",
    highways: new Set([...withoutMotorways, "service", "track", "footway", "path", "pedestrian", "steps"]),
    conditionalHighways: new Set(["cycleway"]),
    accessKeys: ["access", "foot"],
    allowMotorroad: false,
    ignoreOneway: true,
    scoring: SCORING_PROFILES.walk,
    // 徒歩 80m を 1 分 (不動産の表示に関する公正競争規約の徒歩所要時間) = 4.8 km/h
    speed: { kind: "constant", kmh: 4.8 },
    // 徒歩と自転車は同じ重みとし、違いは混在スコアの中身 (何から分かれているか) で出す (仮の値)。
    // 変更前 (混在 0.3・視界 0.5・幅員 0.2) から、混在を 0.3 → 0.5 に上げ、視界を 0.5 → 0.3 に下げた (幅員は 0.2 のまま)。
    // - 混在: 歩行者・自転車にとっては車と分かれていることが最も大事なため重くする
    // - 視界: 視界スコアは道路構造令の最小曲線半径 (車の設計速度ごと) を基準にした車向けの指標で、
    //   徒歩 (約 5km/h)・自転車の速さでは見通しの影響が車より小さいため軽くする
    // - 幅員: 車道の幅は歩行者・自転車の安全に直接は効かないため、軽いまま (0.2) とする
    defaultParameters: { lambda: 1, mix_score_weight: 0.5, view_score_weight: 0.3, width_score_weight: 0.2 },
  },
  bicycle: {
    id: "bicycle",
    name: "自転車",
    highways: new Set([...withoutMotorways, "service", "track", "cycleway", "path"]),
    conditionalHighways: new Set(["footway", "pedestrian"]),
    accessKeys: ["access", "vehicle", "bicycle"],
    allowMotorroad: false,
    ignoreOneway: false,
    onewayKeys: ["oneway:bicycle"],
    scoring: SCORING_PROFILES.bicycle,
    // 15 km/h (仮の値。出典なし。所要時間の表示だけに使い、経路には影響しない)
    speed: { kind: "constant", kmh: 15 },
    // 徒歩と同じ重み (理由は徒歩を参照)
    defaultParameters: { lambda: 1, mix_score_weight: 0.5, view_score_weight: 0.3, width_score_weight: 0.2 },
  },
  car: {
    id: "car",
    name: "車",
    // service (駐車場・施設内の道) は通れるが割高、track (農道・林道) は舗装されていれば通れるが割高
    highways: new Set([...MOTOR_ROADS, "service"]),
    pavedOnlyHighways: new Set(["track"]),
    highwayCostFactor: MOTOR_COST_FACTOR,
    conditionalHighways: new Set(),
    accessKeys: ["access", "vehicle", "motor_vehicle", "motorcar"],
    allowMotorroad: true,
    ignoreOneway: false,
    // 一般的な乗用車の寸法 (寸法制限の判定用の仮の値)
    vehicle: { width: 1.8, height: 1.6, weight: 2 },
    sharpTurnMinRadius: 0,
    scoring: SCORING_PROFILES.car,
    // 高速道路の法定速度 100 km/h (一般道路は travel_speed.ts の法定速度)
    speed: { kind: "motor", motorwayKmh: 100 },
    defaultParameters: { lambda: 1, mix_score_weight: 0.3, view_score_weight: 0.2, width_score_weight: 0.5 },
  },
  motorcycle: {
    id: "motorcycle",
    name: "バイク",
    // 原付は対象外とし、全てのバイクが高速道路を通行できるものとして扱う
    // track / service の扱いは車と同じ
    highways: new Set([...MOTOR_ROADS, "service"]),
    pavedOnlyHighways: new Set(["track"]),
    highwayCostFactor: MOTOR_COST_FACTOR,
    conditionalHighways: new Set(),
    accessKeys: ["access", "vehicle", "motor_vehicle", "motorcycle"],
    allowMotorroad: true,
    ignoreOneway: false,
    // 大型バイクの寸法 (寸法制限の判定用の仮の値)
    vehicle: { width: 1.0, height: 1.5, weight: 0.5 },
    sharpTurnMinRadius: 0,
    scoring: SCORING_PROFILES.motorcycle,
    // 原付は対象外としているので、高速道路は車と同じ 100 km/h
    speed: { kind: "motor", motorwayKmh: 100 },
    defaultParameters: { lambda: 1, mix_score_weight: 0.3, view_score_weight: 0.3, width_score_weight: 0.4 },
  },
  truck: {
    id: "truck",
    name: "大型トラック",
    // track (農道・林道) は舗装されていても通れない。service (配送先の敷地など) は通れるが割高
    highways: new Set([...MOTOR_ROADS.filter((h) => h !== "living_street"), "service"]),
    highwayCostFactor: { service: 2 },
    conditionalHighways: new Set(),
    accessKeys: ["access", "vehicle", "motor_vehicle", "hgv"],
    allowMotorroad: true,
    ignoreOneway: false,
    // 幅・高さは保安基準の上限。総重量は仮の値 (大型貨物自動車等 = 総重量8t以上 に該当する想定)
    vehicle: { width: 2.5, height: 3.8, weight: 20 },
    // 車両制限令 第5条・第6条 (幅 2.5m の車両):
    //   対面通行: (車道幅員 - 0.5m) / 2 ≥ 2.5m → 5.5m 以上 (市街地。市街地外は 5.0m 以上だが、厳しい方に合わせる)
    //   一方通行: 車道幅員 - 0.5m ≥ 2.5m → 3.0m 以上
    minRoadWidth: { twoWay: 5.5, oneWay: 3.0 },
    // 最小回転半径 12m (保安基準第6条) に余裕を見た値 (仮の値)
    sharpTurnMinRadius: 20,
    // 重みは仮の値 (幅員を最重視)
    scoring: SCORING_PROFILES.truck,
    // 大型トラックの高速道路の法定速度 90 km/h (2024-04-01 から。トレーラーは 80 km/h のまま)
    speed: { kind: "motor", motorwayKmh: 90 },
    defaultParameters: { lambda: 1, mix_score_weight: 0.1, view_score_weight: 0.3, width_score_weight: 0.6 },
  },
};

export const MODE_IDS = Object.keys(MODE_PROFILES) as ModeId[];
