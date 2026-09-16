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
  const query = `
    [out:json][timeout:30];
    (
      way["highway"]
        ["highway"!~"footway|cycleway|path|steps|pedestrian|service|track"]
        (${minLat},${minLon},${maxLat},${maxLon});
    );
    out body;
    >;
    out skel qt;
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });

  if (!res.ok) {
    throw new Error(`Overpass API エラー: ${res.status}`);
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
    const width = tags.width ? parseFloat(tags.width) : null;

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

        highway: tags.highway ?? "residential",
        width,
        sidewalk: tags.sidewalk ?? "both",
      };

      edges[edgeId] = edge;
      beginNode.edges.push(edgeId);
      endNode.edges.push(edgeId);
    }
  }

  return { nodes, edges };
}