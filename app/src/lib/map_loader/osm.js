/**
 * @file osm.js
 * @brief OSM(Overpass API)からデータを読み込み、OSM Graph を構築する
 */

import { canTraverseBackward, canTraverseForward, flipDirection } from "../utils/direction";

/**
 * @brief OSM データを読み込み、OSM Graph を作成する
 * @param {number} minLat - 最小緯度
 * @param {number} minLon - 最小経度
 * @param {number} maxLat - 最大緯度
 * @param {number} maxLon - 最大経度
 * @returns {Promise<App.OSMGraph>} OSM Graph
 */
export async function loadOSMMap(minLat, minLon, maxLat, maxLon) {
  const data = await fetchOverpassData(minLat, minLon, maxLat, maxLon);
  return transformOSMMapToOSMGraph(data);
}

/**
 * @brief OSM の返答情報を OSMGraph 型へ変換する
 * @param {App.OSMData} osmMap 
 */
export function transformOSMMapToOSMGraph(osmMap) {
  const { rawNodes, rawWays } = splitElements(osmMap);
  return buildGraphFromWays(rawNodes, rawWays);
}

/**
 * @brief Overpass API へ bbox 内の highway 付き way を問い合わせる
 * @param {number} minLat
 * @param {number} minLon
 * @param {number} maxLat
 * @param {number} maxLon
 * @returns {Promise<App.OSMData>}
 */
async function fetchOverpassData(minLat, minLon, maxLat, maxLon) {
  const res = await fetch("/api/osm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      minLat,
      minLng: minLon,
      maxLat,
      maxLng: maxLon,
      wayHighway: [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "unclassified",
        "residential",
      ]
    }),
  });

  if (!res.ok) {
    throw new Error(`/api/osm API エラー: ${res.status}`);
  }

  return res.json();
}

/**
 * @brief Overpass のレスポンス要素を node / way に分類する
 * @param {{elements: Array<any>}} data
 * @returns {{ rawNodes: {[id:string]: {lat:number, lng:number}}, rawWays: Array<any> }}
 */
function splitElements(data) {
  /** @type {{[id:string]: {lat:number, lng:number}}} */
  const rawNodes = {};
  /** @type {Array<any>} */
  const rawWays = [];

  for (const el of data.elements) {
    if (el.type === "node") {
      rawNodes[String(el.id)] = { lat: el.lat, lng: el.lon };
    } else if (el.type === "way") {
      rawWays.push(el);
    }
  }

  return { rawNodes, rawWays };
}

/**
 * @brief OSM の oneway タグ等から、エッジの通行可能な向きを求める。
 *
 * way のノード順を begin → end とし、oneway=yes なら forward、oneway=-1 なら backward とする。
 * ラウンドアバウト(junction=roundabout) と motorway 系はタグ省略時も一方通行とみなす。
 * @param {{[key: string]: string | undefined}} tags
 * @returns {App.TravelDirection}
 */
function resolveDirection(tags) {
  const oneway = (tags.oneway ?? "").toLowerCase();
  if (oneway === "-1" || oneway === "reverse") return "backward";
  if (oneway === "yes" || oneway === "true" || oneway === "1") return "forward";
  if (oneway === "no" || oneway === "false" || oneway === "0") return "both";
  if (tags.junction === "roundabout" || tags.junction === "circular") return "forward";
  if (tags.highway === "motorway" || tags.highway === "motorway_link") return "forward";
  return "both";
}

/**
 * 多重辺をまとめるときの highway 種別の優先順 (先頭ほど「強い」道。一覧に無い種別は最も弱い)
 */
const HIGHWAY_RANK = [
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link",
  "unclassified", "residential", "living_street", "service", "track",
  "cycleway", "path", "pedestrian", "footway", "steps",
];

/**
 * @brief 多重辺の highway 種別を合成する (強い方の種別を採る)
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function mergeHighway(a, b) {
  const rank = (/** @type {string} */ h) => {
    const i = HIGHWAY_RANK.indexOf(h);
    return i === -1 ? HIGHWAY_RANK.length : i;
  };
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? a : b;
  // 同じ順位 (どちらも一覧に無い種別など) の場合も順序によらないよう、辞書順で決める
  return a <= b ? a : b;
}

/**
 * @brief 多重辺の幅員を合成する (分かっている方の大きい値を採る)
 * @param {number | null} a
 * @param {number | null} b
 * @returns {number | null}
 */
function mergeWidth(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

/**
 * @brief 多重辺の歩道情報を合成する (歩道がある方を優先し、左右が揃えば両側とする)
 * @param {string | null} a
 * @param {string | null} b
 * @returns {string | null}
 */
function mergeSidewalk(a, b) {
  if (a === b) return a;
  const values = new Set([a, b]);
  if (values.has("both") || (values.has("left") && values.has("right"))) return "both";
  const rank = (/** @type {string | null} */ s) =>
    s === "separate" ? 4 : s === "left" || s === "right" || s === "yes" ? 3 : s === "no" || s === "none" ? 2 : s ? 1 : 0;
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  return (a ?? "") <= (b ?? "") ? a : b;
}

/**
 * @brief 生データ(rawNodes, rawWays)から OSM Graph を構築する
 *
 * 交差点判定・セグメント化(次数によるノードの分類や、交差点間の座標列の畳み込み)は
 * ここでは行わない。それは crossTransform(cross_transform.js)以降の責務であり、
 * ここでは各wayの隣接ノードペアをそのまま1本の OSMEdge として展開するだけに留める。
 * @param {{[id:string]: {lat:number, lng:number}}} rawNodes
 * @param {Array<any>} rawWays
 * @returns {App.OSMGraph}
 */
function buildGraphFromWays(rawNodes, rawWays) {
  /** @type {{[id:string]: App.MapNode}} */
  const nodes = {};
  /** @type {{[id:string]: App.OSMEdge}} */
  const edges = {};
  // 同じ 2 ノード間のエッジ (多重辺) を 1 本にまとめるための索引 ("小さいID|大きいID" -> edgeId)
  // way が同じ区間を往復する場合 (a→b→a) や、別の way が同じ区間を重ねて通る場合に多重辺ができ、
  // 交差点変換 (CrossConvert) で同じ ID のノードが二重に作られてしまうため
  /** @type {Map<string, string>} */
  const pairIndex = new Map();

  /**
   * @param {string} rawId
   * @returns {App.MapNode | null}
   */
  const ensureMapNode = (rawId) => {
    if (!rawNodes[rawId]) return null;
    if (!nodes[rawId]) {
      /** @type {App.MapNode} */
      nodes[rawId] = {
        type: "MapNode",
        id: rawId,
        coordinate: { lat: rawNodes[rawId].lat, lng: rawNodes[rawId].lng },
        edges: [],
      };
    }
    return nodes[rawId];
  };

  for (const way of rawWays) {
    const wayId = String(way.id);
    const tags = way.tags ?? {};
    const nodeIds = (way.nodes ?? []).map(String);

    // width タグが無い道路も存在するため、無い場合は null のままにする
    // parseFloat は不正な値(例: "約5m")で NaN を返すことがあるので、有限数のときだけ採用する
    const parsedWidth = parseFloat(tags.width);
    const width = Number.isFinite(parsedWidth) ? parsedWidth : null;
    const direction = resolveDirection(tags);

    for (let i = 0; i < nodeIds.length - 1; i++) {
      const beginId = nodeIds[i];
      const endId = nodeIds[i + 1];
      if (beginId === endId) continue; // 環状路などで同一点が連続する場合はスキップ

      const beginNode = ensureMapNode(beginId);
      const endNode = ensureMapNode(endId);
      if (!beginNode || !endNode) continue; // bbox境界などで座標が無いノードはスキップ

      const pairKey = beginId < endId ? `${beginId}|${endId}` : `${endId}|${beginId}`;
      const existingEdgeId = pairIndex.get(pairKey);
      if (existingEdgeId) {
        // 既存のエッジに、この区間の進行可能な向きを足し合わせる (どちらかで通れる向きは通れる)
        const existing = edges[existingEdgeId];
        const sameOrientation = existing.begin === beginId;
        const dir = sameOrientation ? direction : flipDirection(direction);
        const forward = canTraverseForward(existing.direction) || canTraverseForward(dir);
        const backward = canTraverseBackward(existing.direction) || canTraverseBackward(dir);
        existing.direction = forward && backward ? "both" : forward ? "forward" : backward ? "backward" : "none";
        // タグも両方の way から合成する (way の返却順によらず同じ結果になるようにするため)
        existing.highway = mergeHighway(existing.highway, tags.highway ?? "");
        existing.width = mergeWidth(existing.width, width);
        existing.sidewalk = mergeSidewalk(existing.sidewalk, tags.sidewalk ?? null);

        for (const [key, value] of Object.entries(tags)) {
        // 既存のエッジに name がなく、新しく見つけた方のタグに name がある場合のみ引き継ぐ
        if (!existing.tags.name && tags.name) {
            existing.tags.name = tags.name;
        }

        // ※「国道351号」などをUIに出す場合は、一緒に ref も引き継ぐのがおすすめです
        if (!existing.tags.ref && tags.ref) {
            existing.tags.ref = tags.ref;
        }
      }
        continue;
      }

      const edgeId = `${wayId}_${i}`;
      pairIndex.set(pairKey, edgeId);

      /** @type {App.OSMEdge} */
      const edge = {
        type: "OSMEdge",
        id: edgeId,
        begin: beginId,
        end: endId,

        highway: tags.highway ?? "",
        width,
        sidewalk: tags.sidewalk ?? null,
        direction,
        tags
      };

      edges[edgeId] = edge;
      beginNode.edges.push(edgeId);
      endNode.edges.push(edgeId);
    }
  }

  return { nodes, edges };
}
