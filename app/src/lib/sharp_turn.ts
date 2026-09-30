/**
 * 経路上の急カーブ (道の途中のカーブ) を検出する
 *
 * 考え方:
 * - 曲がり角の大きさだけでは危険度を判定できない (同じ 90° でも 10m で曲がるのと 200m かけて曲がるのでは違う)。
 *   そこで「曲がった角度 θ」と「曲がるのにかかった距離 L」から曲線半径 R = L / θ を推定して判定する。
 * - OSM の道は折れ線なので、同じ向きに続けて曲がる頂点を 1 つのカーブとしてまとめてから R を求める。
 *   半径 R の円弧を間隔 d の折れ線で描くと、各頂点の曲がり角は d / R になるため、
 *   L / θ を計算すると折れ線の描き方 (頂点の数) によらず元の円弧の半径に近い値になる。
 * - 交差点での右左折は対象外。探索グラフの交差点 (MapVCrossEdge) に加え、
 *   モードの絞り込みでグラフから外れた道 (track など) との交差点でも区切る (collectRoadJunctions)。
 *
 * 判定基準:
 * - 道路構造令 第15条の最小曲線半径 (縮小値) より急なカーブを急カーブとする。
 *   ただし基準がゆるい広い道 (tertiary 80m など) で拾いすぎないよう、上限を 30m (設計速度 30km/h 相当) とする。
 *   つまり「おおむね 30km/h 以下に減速が必要なカーブ」だけを拾う。
 *   highway 種別と設計速度の対応は cost_calculator.js の視界スコアと同じ。
 * - モードごとの下限 (大型トラックは最小回転半径 12m (保安基準第6条) に余裕を見た値) より急なカーブも急カーブとする。
 */

export type SharpTurn = {
  /** カーブの中で最も大きく曲がる頂点の座標 */
  coordinate: App.Coordinate;
  /** カーブ全体の曲がり角 [度] */
  angle: number;
  /** 推定した曲線半径 [m] */
  radius: number;
  /** 曲がる向き */
  direction: "left" | "right";
  /** カーブがある道の highway 種別 */
  highway: string;
  /**
   * 危険度。半径が SHARP_LEVEL_RADIUS_M 未満なら "sharp" (急カーブ・ヘアピンなど)、
   * それ以上なら "caution" (注意が必要なカーブ)
   */
  level: "sharp" | "caution";
};

export type SharpTurnOptions = {
  /** モードごとの曲線半径の下限 [m]。道の基準値とこの値の大きい方より急なカーブを急カーブとする */
  minRadius: number;
  /**
   * 交差点の座標 (coordinateKey で作ったキー)。この頂点で道を区切り、交差点での曲がりは急カーブとして扱わない
   * (collectRoadJunctions で元の OSM データから求める)
   */
  junctions?: ReadonlySet<string>;
  /**
   * 地図データを取得した範囲。範囲外の頂点では道を区切る
   * (範囲外の道は取得されていないため、範囲の外で交わる道が見えず、交差点をカーブと誤判定してしまうため)
   */
  bounds?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
};

/** 座標を Set のキーにする (OSM のノード座標をそのまま使うので完全一致で比較できる) */
export function coordinateKey(c: App.Coordinate): string {
  return `${c.lat},${c.lng}`;
}

/**
 * 交差点の判定に使う道の種類 (車両が通る道)。
 * 歩道・自転車道との交差 (横断歩道など) では区切らない (区切るとカーブが途中で切れて検出できなくなるため)
 */
const JUNCTION_HIGHWAYS = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link",
  "unclassified", "residential", "living_street", "service", "track", "road", "busway",
]);
/** 交差点とみなさない service 道路 (沿道の駐車場の出入口などでカーブを分断しないため) */
const IGNORED_SERVICE = new Set(["driveway", "parking_aisle", "drive-through"]);

/**
 * 元の OSM データ (モードで絞り込む前) から、車両が通る道が 3 方向以上つながっている点 (交差点) の座標を求める
 *
 * 経路探索用のグラフはモードで通れない道を取り除いてから作るため、
 * 例えば「tertiary と track の交差点」は車モードのグラフでは交差点にならず、1 本の曲がった道に見えてしまう。
 * そのため交差点は絞り込む前のデータで判定する。
 *
 * @param data モードで絞り込む前の OSM データ
 * @returns 交差点の座標のキー (coordinateKey) の集合
 */
export function collectRoadJunctions(data: App.OSMData): Set<string> {
  const coords = new Map<number, App.Coordinate>();
  for (const el of data.elements) {
    if (el.type === "node") coords.set(el.id, { lat: el.lat, lng: el.lon });
  }

  // ノードごとに、隣り合うノードの集合を作る (同じ道が往復する場合や道同士の重なりは 1 方向として数える)
  const neighbors = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a)!.add(b);
  };
  for (const el of data.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags ?? {};
    if (!JUNCTION_HIGHWAYS.has(tags.highway)) continue;
    if (tags.highway === "service" && IGNORED_SERVICE.has(tags.service)) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      if (el.nodes[i] === el.nodes[i + 1]) continue;
      link(el.nodes[i], el.nodes[i + 1]);
      link(el.nodes[i + 1], el.nodes[i]);
    }
  }

  const junctions = new Set<string>();
  for (const [nodeId, ns] of neighbors) {
    const c = coords.get(nodeId);
    if (ns.size >= 3 && c) junctions.add(coordinateKey(c));
  }
  return junctions;
}

/** これ未満の合計角度のカーブは拾わない (折れ線のガタつきやゆるい曲がりを除外するため・仮の値) [度] */
export const MIN_TOTAL_ANGLE_DEG = 50;
/**
 * 急カーブとみなす曲線半径の上限 [m]。道の基準値がこれより大きくてもこの値で打ち切る
 * (道路構造令 第15条で設計速度 30km/h の最小曲線半径が 30m のため)
 */
export const SHARP_RADIUS_CAP_M = 30;
/**
 * これ未満の半径のカーブを「急カーブ」、それ以上を「注意」とする [m] (仮の値)
 * 道路構造令 第15条で設計速度 20km/h の最小曲線半径が 15m、30km/h が 30m であり、その間の目安として 20m とした
 */
export const SHARP_LEVEL_RADIUS_M = 20;
/** これ未満の曲がり角の頂点は直進とみなす [度] */
const MIN_VERTEX_ANGLE_DEG = 1;
/** 曲がる頂点同士がこれ以上離れていたら別のカーブとみなす [m] */
const MAX_GAP_M = 30;
/** カーブの両端で、前後の区間から長さに含める上限 [m] */
const MAX_HALF_SEGMENT_M = 15;

/**
 * highway 種別ごとの最小曲線半径 [m]
 * 道路構造令 第15条の縮小値 (設計速度 120/100/80/60/50/40/30/20 km/h → 570/380/230/120/80/50/30/15 m)
 */
const STANDARD_MIN_RADIUS: Record<string, number> = {
  motorway: 570,
  trunk: 380,
  primary: 230,
  secondary: 120,
  tertiary: 80,
  unclassified: 50,
  residential: 30,
  // ランプは設計速度が低いため 40km/h 相当とする (仮の値)
  motorway_link: 50,
  trunk_link: 50,
  primary_link: 50,
  secondary_link: 50,
  tertiary_link: 50,
  // 低速の道は 20km/h 相当とする
  living_street: 15,
  service: 15,
  track: 15,
};
const DEFAULT_MIN_RADIUS = 30;

/** highway 種別の最小曲線半径 [m] (不明な種別は 30m) */
export function standardMinRadius(highway: string): number {
  return STANDARD_MIN_RADIUS[highway] ?? DEFAULT_MIN_RADIUS;
}

const EARTH_RADIUS_M = 6371008.8;

/**
 * 進行方向に並んだセグメント列 (つながった 1 本の道) から急カーブを検出する
 *
 * @param segments 進行方向に並んだセグメント (前のセグメントの終点 = 次のセグメントの始点)
 * @param options モードごとの判定条件
 */
export function detectSharpTurns(segments: App.Segment[], options: SharpTurnOptions): SharpTurn[] {
  if (segments.length === 0) return [];

  // --- 1. 平面座標 [m] に変換して折れ線の頂点列を作る (長さ 0 の区間は除く) ---
  const origin = segments[0].begin_coordinate;
  const lat0 = (origin.lat * Math.PI) / 180;
  const toXY = (c: App.Coordinate) => [
    ((c.lng - origin.lng) * Math.PI / 180) * Math.cos(lat0) * EARTH_RADIUS_M,
    ((c.lat - origin.lat) * Math.PI / 180) * EARTH_RADIUS_M,
  ];
  const coords: App.Coordinate[] = [origin];
  const xy: number[][] = [toXY(origin)];
  /** highways[i] = coords[i] → coords[i+1] の区間の highway 種別 */
  const highways: string[] = [];
  for (const seg of segments) {
    const p = toXY(seg.end_coordinate);
    const prev = xy[xy.length - 1];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.01) continue;
    coords.push(seg.end_coordinate);
    xy.push(p);
    highways.push(seg.highway);
  }
  if (coords.length < 3) return [];

  // --- 2. 各頂点の曲がり角と累積距離を求める ---
  const segLen: number[] = [];
  for (let i = 0; i < xy.length - 1; i++) {
    segLen.push(Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]));
  }
  const cumDist: number[] = [0];
  for (const len of segLen) cumDist.push(cumDist[cumDist.length - 1] + len);

  /** turn[i] = 頂点 i での曲がり角 [rad] (左が正) */
  const turn: number[] = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length - 1; i++) {
    const ax = xy[i][0] - xy[i - 1][0], ay = xy[i][1] - xy[i - 1][1];
    const bx = xy[i + 1][0] - xy[i][0], by = xy[i + 1][1] - xy[i][1];
    turn[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }

  // --- 3. 同じ向きに続けて曲がる頂点を 1 つのカーブにまとめる ---
  type Group = { first: number; last: number; sum: number; peak: number };
  const groups: Group[] = [];
  const minVertex = (MIN_VERTEX_ANGLE_DEG * Math.PI) / 180;
  let current: Group | null = null;
  for (let i = 1; i < coords.length - 1; i++) {
    const outOfBounds = options.bounds !== undefined && (
      coords[i].lat < options.bounds.minLat || coords[i].lat > options.bounds.maxLat ||
      coords[i].lng < options.bounds.minLng || coords[i].lng > options.bounds.maxLng
    );
    if (outOfBounds || options.junctions?.has(coordinateKey(coords[i]))) {
      // 交差点・取得範囲外では道を区切る (交差点での曲がりは対象外。範囲外は交差する道が見えないため判定しない)
      if (current) groups.push(current);
      current = null;
      continue;
    }
    if (Math.abs(turn[i]) < minVertex) continue;
    const continues =
      current !== null &&
      Math.sign(turn[i]) === Math.sign(current.sum) &&
      cumDist[i] - cumDist[current.last] <= MAX_GAP_M;
    if (current !== null && continues) {
      current.last = i;
      current.sum += turn[i];
      if (Math.abs(turn[i]) > Math.abs(turn[current.peak])) current.peak = i;
    } else {
      if (current) groups.push(current);
      current = { first: i, last: i, sum: turn[i], peak: i };
    }
  }
  if (current) groups.push(current);

  // --- 4. カーブごとに曲線半径を推定して判定する ---
  const result: SharpTurn[] = [];
  for (const g of groups) {
    const theta = Math.abs(g.sum);
    const angleDeg = (theta * 180) / Math.PI;
    if (angleDeg < MIN_TOTAL_ANGLE_DEG) continue;

    // カーブの長さ
    // - 頂点が複数: 最初と最後の頂点の間の長さ (円弧を折れ線で描いた場合、両端の接点も曲がる頂点になるため
    //   この長さと合計角度から元の円弧の半径がほぼそのまま求まる)
    // - 頂点が 1 つ (角): 前後の区間の半分ずつ (上限あり) を長さとみなす
    const length = g.first === g.last
      ? Math.min(segLen[g.first - 1] / 2, MAX_HALF_SEGMENT_M) + Math.min(segLen[g.last] / 2, MAX_HALF_SEGMENT_M)
      : cumDist[g.last] - cumDist[g.first];
    const radius = length / theta;

    const highway = highways[g.peak] ?? highways[g.peak - 1] ?? "";
    const threshold = Math.max(Math.min(standardMinRadius(highway), SHARP_RADIUS_CAP_M), options.minRadius);
    if (radius >= threshold) continue;

    result.push({
      coordinate: coords[g.peak],
      angle: angleDeg,
      radius,
      direction: g.sum > 0 ? "left" : "right",
      highway,
      level: radius < SHARP_LEVEL_RADIUS_M ? "sharp" : "caution",
    });
  }
  return result;
}

/**
 * 探索結果の経路から急カーブを検出する
 *
 * 交差点 (MapVCrossEdge) で道を区切り、道ごとに detectSharpTurns を呼ぶ。
 * 交差点以外で隣り合うエッジ (始点・終点の分割ノードをまたぐ場合など) は 1 本の道としてつなげる。
 *
 * @param graph 探索したグラフ
 * @param edgeIds 経路の辺リスト (進行順)
 * @param startNodeId 経路の始点ノード (辺をどちら向きに通ったかの判定に使う)
 * @param options モードごとの判定条件
 */
export function detectSharpTurnsOnPath(
  graph: App.SearchGraph,
  edgeIds: App.EdgeId[],
  startNodeId: App.NodeId,
  options: SharpTurnOptions,
): SharpTurn[] {
  const result: SharpTurn[] = [];
  let road: App.Segment[] = [];
  const flush = () => {
    result.push(...detectSharpTurns(road, options));
    road = [];
  };

  let currentNodeId = startNodeId;
  for (const edgeId of edgeIds) {
    const edge = graph.edges[edgeId];
    if (!edge) continue;
    const reversed = edge.begin !== currentNodeId && edge.end === currentNodeId;
    currentNodeId = reversed ? edge.begin : edge.end;

    if (edge.type === "MapVCrossEdge") {
      // 交差点で道を区切る (交差点での右左折は対象外)
      flush();
      continue;
    }

    // segments は begin → end の向きなので、end 側から入った場合は反転する
    const segments = reversed
      ? edge.segments.toReversed().map((s) => ({ ...s, begin_coordinate: s.end_coordinate, end_coordinate: s.begin_coordinate }))
      : edge.segments;
    road.push(...segments);
  }
  flush();
  return result;
}
