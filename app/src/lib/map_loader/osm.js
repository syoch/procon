/**
 * @file osm.js
 * @brief OSM(Overpass API)からデータを読み込み、OSM Graph を構築する
 */

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
  const { rawNodes, rawWays } = splitElements(data);
  return buildGraphFromWays(rawNodes, rawWays);
}

/**
 * @brief Overpass API へ bbox 内の highway 付き way を問い合わせる
 * @param {number} minLat
 * @param {number} minLon
 * @param {number} maxLat
 * @param {number} maxLon
 * @returns {Promise<{elements: Array<any>}>}
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
      wayHighwayExcludes: ["footway", "path", "steps", "pedestrian", "service", "track"],
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

      const edgeId = `${wayId}_${i}`;

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
      };

      edges[edgeId] = edge;
      beginNode.edges.push(edgeId);
      endNode.edges.push(edgeId);
    }
  }

  return { nodes, edges };
}
