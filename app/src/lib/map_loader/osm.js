/**
 * @file osm.js
 * @brief OSM(Overpass API)からデータを読み込み、交差点をノードとする OSM Graph を構築する
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
 * @brief 交差点ノード(=グラフの実ノードとなる点)のIDセットを求める
 *  次のいずれかを満たすノードを「交差点」とみなす:
 *   ① 2つ以上のwayに共有されている
 *   ② wayの端点(始点/終点) ※行き止まりの道路にも対応するため
 * @param {Array<any>} rawWays
 * @returns {Set<string>}
 */
function findIntersectionNodeIds(rawWays) {
  /** @type {{[nodeId:string]: number}} */
  const wayCountByNode = {};

  for (const way of rawWays) {
    const nodeIds = way.nodes ?? [];
    const seenInThisWay = new Set(); // 同じwayの中の重複(環状路など)は1回とカウント
    for (const rawId of nodeIds) {
      const id = String(rawId);
      if (seenInThisWay.has(id)) continue;
      seenInThisWay.add(id);
      wayCountByNode[id] = (wayCountByNode[id] ?? 0) + 1;
    }
  }

  const intersectionIds = new Set();
  for (const [id, count] of Object.entries(wayCountByNode)) {
    if (count >= 2) intersectionIds.add(id);
  }

  for (const way of rawWays) {
    const nodeIds = way.nodes ?? [];
    if (nodeIds.length === 0) continue;
    intersectionIds.add(String(nodeIds[0]));
    intersectionIds.add(String(nodeIds[nodeIds.length - 1]));
  }

  return intersectionIds;
}

/**
 * @brief 生データ(rawNodes, rawWays)から交差点をノードとする OSM Graph を構築する
 *  各wayを交差点ノードの位置でセグメントに分割し、セグメントごとに1エッジを作る。
 *  セグメント内の中間の形状点(交差点でない点)はグラフノードにはせず、
 *  座標列を edge.geometry として保持する(begin→endの間の全座標、両端含む)。
 * @param {{[id:string]: {lat:number, lng:number}}} rawNodes
 * @param {Array<any>} rawWays
 * @returns {App.OSMGraph}
 */
function buildGraphFromWays(rawNodes, rawWays) {
  /** @type {{[id:string]: App.MapNode}} */
  const nodes = {};
  /** @type {{[id:string]: App.OSMEdge}} */
  const edges = {};

  const intersectionIds = findIntersectionNodeIds(rawWays);

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

    /** @type {{lat:number, lng:number}[]} */
    let segmentGeometry = [];
    /** @type {string | null} */
    let segmentBeginId = null;
    let segmentIndex = 0;

    for (let i = 0; i < nodeIds.length; i++) {
      const currentId = nodeIds[i];
      if (!rawNodes[currentId]) continue; // bbox境界などで座標が無いノードはスキップ

      if (segmentBeginId === null) {
        // セグメント開始点(直前の交差点、またはwayの先頭)
        segmentBeginId = currentId;
        segmentGeometry = [{ lat: rawNodes[currentId].lat, lng: rawNodes[currentId].lng }];
        continue;
      }

      segmentGeometry.push({ lat: rawNodes[currentId].lat, lng: rawNodes[currentId].lng });

      if (intersectionIds.has(currentId) && currentId !== segmentBeginId) {
        // 交差点に到達 → ここまでを1エッジとして確定する
        const beginNode = ensureMapNode(segmentBeginId);
        const endNode = ensureMapNode(currentId);

        if (beginNode && endNode) {
          const edgeId = `${wayId}_${segmentIndex}`;
          segmentIndex++;

          /** @type {App.OSMEdge} */
          const edge = {
            type: "OSMEdge",
            id: edgeId,
            begin: segmentBeginId,
            end: currentId,

            highway: tags.highway ?? "residential",
            width: tags.width ? parseFloat(tags.width) : null,
            sidewalk: tags.sidewalk ?? null,

            // begin→endの間の形状点の座標列(両端含む)。距離計算やカーブ評価に使う。
            geometry: segmentGeometry,
          };

          edges[edgeId] = edge;
          beginNode.edges.push(edgeId);
          endNode.edges.push(edgeId);
        }

        // 次のセグメントをこの交差点から開始する
        segmentBeginId = currentId;
        segmentGeometry = [{ lat: rawNodes[currentId].lat, lng: rawNodes[currentId].lng }];
      }
    }
  }

  return { nodes, edges };
}