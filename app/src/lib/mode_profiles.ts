/**
 * 移動モード (徒歩・自転車・車・バイク・大型トラック) ごとの通行ルールと既定パラメータ
 *
 * 通行できるかどうか (ハード制約) はここで一元的に判定する。
 * スコアの重み (ソフトな好み) は defaultParameters で持ち、探索時に上書きもできる。
 *
 * 参考:
 * - access 系タグの階層 (具体的なキーほど優先): https://wiki.openstreetmap.org/wiki/JA:Key:access
 * - 大型貨物自動車の規制 (hgv): https://wiki.openstreetmap.org/wiki/JA:Key:hgv
 * - 歩行者・自転車・原付などの高速道路/自動車専用道路の通行禁止: 道路法第48条の11、高速自動車国道法第17条
 * - 自動車の大きさの上限 (幅2.5m・高さ3.8m): 道路運送車両の保安基準 第2条
 */

export type ModeId = "walk" | "bicycle" | "car" | "motorcycle" | "truck";

/** 車両の寸法 (寸法制限タグ maxwidth / maxheight / maxweight の判定に使う) */
export type VehicleSize = {
  /** 幅 [m] */
  width: number;
  /** 高さ [m] */
  height: number;
  /** 総重量 [t] */
  weight: number;
};

export type ModeProfile = {
  id: ModeId;
  /** 表示名 */
  name: string;
  /** 通行できる highway 種別 */
  highways: ReadonlySet<string>;
  /**
   * 舗装されている (tracktype=grade1 か、surface が舗装) ときだけ通行できる highway 種別
   * 例: 車の track (農道・林道) は、舗装されていれば通れる
   */
  pavedOnlyHighways?: ReadonlySet<string>;
  /**
   * highway 種別ごとのコストの倍率。通れるが、なるべく避けたい道に使う (path_finder.ts の PathFindOptions)
   * 幅員の情報が入るまでのつなぎとして、幅が分からない track / service を割高にしている (仮の値)
   */
  highwayCostFactor?: Readonly<Record<string, number>>;
  /**
   * タグで明示的に許可されている (yes / designated / permissive) ときだけ通行できる highway 種別
   * 例: 自転車の footway は bicycle=yes (自転車歩道通行可) のときだけ通れる
   */
  conditionalHighways: ReadonlySet<string>;
  /** access 系タグの参照順 (一般 → 具体)。後ろのキーほど優先される */
  accessKeys: readonly string[];
  /** 自動車専用道路 (motorroad=yes) を通行できるか */
  allowMotorroad: boolean;
  /** 一方通行を無視するか (徒歩は一方通行に従う必要がない) */
  ignoreOneway: boolean;
  /**
   * このモード専用の一方通行タグ。付いていれば oneway タグより優先する
   * 例: oneway=yes かつ oneway:bicycle=no の道 (自転車は双方向に通れる)
   */
  onewayKeys?: readonly string[];
  /** 車両の寸法 (徒歩・自転車は判定しないので undefined) */
  vehicle?: VehicleSize;
  /**
   * 急カーブ判定の曲線半径の下限 [m] (sharp_turn.ts)。道の基準値とこの値の大きい方より急なカーブを急カーブとする。
   * undefined のモードは急カーブを検出しない
   */
  sharpTurnMinRadius?: number;
  /** 既定の探索パラメータ */
  defaultParameters: App.SearchParameters;
};

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

/** 通行を認めない access 系タグの値 (これ以外の値は通行可として扱う) */
const DENY_VALUES = new Set(["no", "private", "agricultural", "forestry", "permit", "military"]);
/** 明示的な許可とみなす値 (conditionalHighways の判定に使う) */
const EXPLICIT_ALLOW_VALUES = new Set(["yes", "designated", "permissive"]);

/** 舗装とみなす surface タグの値 */
const PAVED_SURFACES = new Set(["paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "chipseal"]);

/** 舗装されている道か (tracktype=grade1 は「舗装または固く締まった路面」) */
export function isPaved(tags: Record<string, string>): boolean {
  return tags.tracktype === "grade1" || PAVED_SURFACES.has(tags.surface);
}

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
    defaultParameters: { lambda: 1, mix_score_weight: 0.3, view_score_weight: 0.5, width_score_weight: 0.2 },
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
    defaultParameters: { lambda: 1, mix_score_weight: 0.3, view_score_weight: 0.4, width_score_weight: 0.3 },
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
    // 最小回転半径 12m (保安基準第6条) に余裕を見た値 (仮の値)
    sharpTurnMinRadius: 20,
    // 重みは仮の値 (幅員を最重視)
    defaultParameters: { lambda: 1, mix_score_weight: 0.1, view_score_weight: 0.3, width_score_weight: 0.6 },
  },
};

export const MODE_IDS = Object.keys(MODE_PROFILES) as ModeId[];

/**
 * 寸法制限タグの値を数値に変換する ("4.5", "4.5m", "8 t" など)
 * 数値にできない値 ("default", "below_default" など) は undefined として扱い、制限なしとみなす
 */
export function parseDimension(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|t)?$/i);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * モード専用の一方通行タグ (onewayKeys) の値を返す (無ければ undefined = oneway タグに従う)
 */
export function resolveModeOneway(profile: ModeProfile, tags: Record<string, string>): string | undefined {
  for (const key of profile.onewayKeys ?? []) {
    if (tags[key] !== undefined) return tags[key];
  }
  return undefined;
}

/**
 * access 系タグを階層順に見て、最も具体的なキーの値を返す (どれも無ければ undefined)
 */
function resolveAccessValue(profile: ModeProfile, tags: Record<string, string>): string | undefined {
  let value: string | undefined = undefined;
  for (const key of profile.accessKeys) {
    if (tags[key] !== undefined) {
      value = tags[key];
    }
  }
  return value;
}

/**
 * OSM の way のタグから、そのモードで通行できるかを判定する
 *
 * @param profile 移動モード
 * @param tags way のタグ
 * @returns 通行できるなら true
 */
export function isAccessible(profile: ModeProfile, tags: Record<string, string>): boolean {
  const highway = tags.highway;
  if (!highway) return false;

  const access = resolveAccessValue(profile, tags);

  // 1. highway 種別
  if (profile.pavedOnlyHighways?.has(highway)) {
    // 舗装されている場合だけ通れる
    if (!isPaved(tags)) return false;
  } else if (!profile.highways.has(highway)) {
    if (!profile.conditionalHighways.has(highway)) return false;
    // タグで明示的に許可されている場合だけ通れる
    if (access === undefined || !EXPLICIT_ALLOW_VALUES.has(access)) return false;
  }

  // 2. 自動車専用道路
  if (!profile.allowMotorroad && tags.motorroad === "yes") return false;

  // 3. access 系タグ (具体的なキーが優先)
  if (access !== undefined && DENY_VALUES.has(access)) return false;

  // 4. 寸法制限 (車両のみ)
  if (profile.vehicle) {
    const maxwidth = parseDimension(tags.maxwidth);
    if (maxwidth !== undefined && maxwidth < profile.vehicle.width) return false;
    const maxheight = parseDimension(tags.maxheight);
    if (maxheight !== undefined && maxheight < profile.vehicle.height) return false;
    const maxweight = parseDimension(tags.maxweight);
    if (maxweight !== undefined && maxweight < profile.vehicle.weight) return false;
  }

  return true;
}
