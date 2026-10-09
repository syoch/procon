/**
 * 国土地理院「道路中心線」の幅員を OSM の道に対応付け、道の幅 (width) を補う
 *
 * OSM には幅員の情報がほとんど無い (長岡周辺で width タグの付与率 0.03%) ため、
 * 国土地理院の道路中心線 (電子国土基本図) の幅員区分 rnkWidth を、位置と向きが近い OSM の区間に移す。
 *
 * - OSM に width タグがある道は、そちらを優先する (上書きしない)
 * - 使うのは種別が「通常部」の線だけ (庭園路・徒歩道の幅員を車道に移さないため)
 * - 国土地理院のデータは 2013〜2016 年のもので、それ以降にできた道には対応する線が無い
 *   (その道は幅不明のまま、highway 種別からの推定にフォールバックする)
 *
 * タイルの読み取りは gsi/parse.ts が持つ。
 */

import type { GsiRoadSegment } from "./gsi/parse";

/**
 * 幅が分かっているか (正の数か)
 * 幅不明の表し方は null (osm.js) や -1 (debug.ts) など複数あるため、cost_calculator.js の平均幅と同じく「正の数なら判明」で判定する
 */
export function isKnownWidth(width: unknown): width is number {
  return typeof width === "number" && Number.isFinite(width) && width > 0;
}

/** 対応付けの条件: OSM の区間の中点から国土地理院の線までの距離の上限 [m] */
export const MATCH_MAX_DISTANCE_M = 12;
/** 対応付けの条件: 向きの差の上限 [度] (線の向き (前後) は区別しない) */
export const MATCH_MAX_ANGLE_DEG = 30;

/** 幅員を補う OSM の道の種類 (車両が通る道。歩道などには車道の幅員を移さない) */
export const MATCH_HIGHWAYS: ReadonlySet<string> = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link",
  "unclassified", "residential", "living_street", "service", "track", "road", "busway",
]);

const EARTH_RADIUS_M = 6371008.8;
/** 空間グリッドの 1 マスの大きさ [度] (約 50m。探索は周囲 1 マスまで見るので MATCH_MAX_DISTANCE_M より十分大きいこと) */
const GRID_DEG = 0.0005;

type IndexedSegment = GsiRoadSegment & { ax: number; ay: number; bx: number; by: number; angle: number };

/**
 * 空間グリッドで高速に近傍を探せる形にした国土地理院の区間の集合
 */
export class GsiRoadIndex {
  private readonly grid = new Map<string, IndexedSegment[]>();
  private readonly lat0: number;
  private readonly cosLat0: number;

  constructor(segments: GsiRoadSegment[]) {
    this.lat0 = segments.length > 0 ? segments[0].begin.lat : 0;
    this.cosLat0 = Math.cos((this.lat0 * Math.PI) / 180);
    for (const seg of segments) {
      const [ax, ay] = this.toXY(seg.begin);
      const [bx, by] = this.toXY(seg.end);
      if (ax === bx && ay === by) continue;
      const indexed: IndexedSegment = { ...seg, ax, ay, bx, by, angle: Math.atan2(by - ay, bx - ax) };
      // 区間が通るマスすべてに登録する (区間の外接矩形のマス)
      const [minI, maxI] = [Math.floor(Math.min(seg.begin.lat, seg.end.lat) / GRID_DEG), Math.floor(Math.max(seg.begin.lat, seg.end.lat) / GRID_DEG)];
      const [minJ, maxJ] = [Math.floor(Math.min(seg.begin.lng, seg.end.lng) / GRID_DEG), Math.floor(Math.max(seg.begin.lng, seg.end.lng) / GRID_DEG)];
      for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
          const key = `${i},${j}`;
          const list = this.grid.get(key);
          if (list) list.push(indexed);
          else this.grid.set(key, [indexed]);
        }
      }
    }
  }

  /** 平面座標 [m] (小さい範囲なので正距円筒の近似) */
  private toXY(c: App.Coordinate): [number, number] {
    return [
      ((c.lng * Math.PI) / 180) * this.cosLat0 * EARTH_RADIUS_M,
      ((c.lat * Math.PI) / 180) * EARTH_RADIUS_M,
    ];
  }

  /**
   * OSM の区間 (begin → end) に対応する国土地理院の区間の幅員 [m] を返す (見つからなければ undefined)
   * 区間の中点から 12m 以内・向きの差 30° 以内で、最も近いものを採用する
   */
  findWidth(begin: App.Coordinate, end: App.Coordinate): number | undefined {
    const [ax, ay] = this.toXY(begin);
    const [bx, by] = this.toXY(end);
    if (ax === bx && ay === by) return undefined;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const angle = Math.atan2(by - ay, bx - ax);
    const midLat = (begin.lat + end.lat) / 2, midLng = (begin.lng + end.lng) / 2;
    const ci = Math.floor(midLat / GRID_DEG), cj = Math.floor(midLng / GRID_DEG);

    let best: IndexedSegment | undefined;
    let bestDistance = MATCH_MAX_DISTANCE_M;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const seg of this.grid.get(`${i},${j}`) ?? []) {
          if (angleDiffDeg(angle, seg.angle) > MATCH_MAX_ANGLE_DEG) continue;
          const d = distancePointToSegment(mx, my, seg.ax, seg.ay, seg.bx, seg.by);
          if (d <= bestDistance) {
            bestDistance = d;
            best = seg;
          }
        }
      }
    }
    return best?.width;
  }
}

/** 2 つの向きの差 [度] (0〜90°。線の前後は区別しない) */
function angleDiffDeg(a: number, b: number): number {
  let d = (Math.abs(a - b) * 180) / Math.PI % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/** 点 (px, py) から線分 (ax, ay)-(bx, by) までの距離 */
function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / len2, 0), 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 幅員を補う対象のグラフ。
 * OSMGraph のほか、交差点変換後のグラフ (幅員に依存しない部分を 1 回だけ作って共有する) も渡せる。
 * 交差点内部のエッジは highway を持たないため、補完の対象から外れる。
 */
export type WidthApplicableGraph = {
  nodes: Record<string, { coordinate: App.Coordinate } | undefined>;
  edges: Record<string, { begin: App.NodeId; end: App.NodeId; highway?: string; width?: number | null }>;
};

/**
 * OSM グラフの車道のうち、幅が分からない区間に国土地理院の幅員を補う (graph を直接書き換える)
 *
 * @returns 幅を補った区間の数
 */
export function applyGsiWidths(graph: WidthApplicableGraph, index: GsiRoadIndex): number {
  let applied = 0;
  for (const edge of Object.values(graph.edges)) {
    // OSM の width タグがある道はそちらを優先する
    if (isKnownWidth(edge.width)) continue;
    // 交差点内部のエッジなど、highway を持たない区間は対象外
    if (edge.highway === undefined || !MATCH_HIGHWAYS.has(edge.highway)) continue;
    const begin = graph.nodes[edge.begin]?.coordinate;
    const end = graph.nodes[edge.end]?.coordinate;
    if (!begin || !end) continue;

    const width = index.findWidth(begin, end);
    if (width !== undefined) {
      edge.width = width;
      applied++;
    }
  }
  return applied;
}

/** 幅員の網羅率 (幅員を補う対象の道のうち、幅が分かっている区間の割合) */
export type WidthCoverage = {
  /** 幅が分かっている区間の数 */
  known: number;
  /** 幅員を補う対象 (MATCH_HIGHWAYS) の区間の数 */
  total: number;
  /** known / total (対象が無ければ null) */
  ratio: number | null;
};

/**
 * 幅員の網羅率を求める (applyGsiWidths の後に呼ぶ)
 *
 * 幅が分からない道は removeNarrowEdges で取り除かないため、国土地理院のタイルが取れなかった範囲
 * (タイル数・時間の上限を超えた、取得に失敗した) では幅の制限が効かず、大型トラックの判定がゆるくなる。
 * 同じ検索でもキャッシュの有無で結果が変わりうるので、この値を応答やログに出して観測できるようにする
 */
export function measureWidthCoverage(graph: App.OSMGraph): WidthCoverage {
  return measureSegmentsWidthCoverage(Object.values(graph.edges));
}

/**
 * 区間の一覧 (経路の区間など) の幅員の網羅率を求める
 * 国土地理院のタイルは経路の周りだけ取得するので、経路探索では経路の区間について求める (pathFind.ts)
 */
export function measureSegmentsWidthCoverage(segments: Iterable<{ highway: string; width: number | null }>): WidthCoverage {
  let known = 0;
  let total = 0;
  for (const segment of segments) {
    if (!MATCH_HIGHWAYS.has(segment.highway)) continue;
    total++;
    if (isKnownWidth(segment.width)) known++;
  }
  return { known, total, ratio: total > 0 ? known / total : null };
}

/** 車両制限令による、車両が通れる道の幅の下限 [m] */
export type RoadWidthLimit = {
  /** 対面通行の道 */
  twoWay: number;
  /** 一方通行の道 */
  oneWay: number;
};

/**
 * 幅が分かっていて、下限より狭い道をグラフから取り除く (graph を直接書き換える)
 * 幅が分からない道は取り除かない。道を取り除いてつながる道が無くなったノードも取り除く
 * (そのため取り除く道の数は幅員の網羅率に左右される。measureWidthCoverage を参照)
 *
 * @returns 取り除いた区間の数
 */
export function removeNarrowEdges(graph: App.OSMGraph, limit: RoadWidthLimit): number {
  let removed = 0;
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (!isKnownWidth(edge.width)) continue;
    const required = edge.direction === "both" ? limit.twoWay : limit.oneWay;
    if (edge.width >= required) continue;

    delete graph.edges[edgeId];
    for (const nodeId of [edge.begin, edge.end]) {
      const node = graph.nodes[nodeId];
      if (!node) continue;
      node.edges = node.edges.filter((id) => id !== edgeId);
      if (node.edges.length === 0) delete graph.nodes[nodeId];
    }
    removed++;
  }
  return removed;
}
