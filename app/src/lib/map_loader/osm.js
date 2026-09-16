/**
 * @brief OSM データを読み込み、OSM Graph を作成する
 * @param {number} minLat - 最小緯度
 * @param {number} minLon - 最小経度
 * @param {number} maxLat - 最大緯度
 * @param {number} maxLon - 最大経度
 * @returns {Promise<App.OSMGraph>} OSM Graph
 */
export async function loadOSMMap(minLat, minLon, maxLat, maxLon) {
  void minLat;
  void minLon;
  void maxLat;
  void maxLon;

  /** @type {{ [key: string]: App.MapNode }} */
  let nodes = {};
  /** @type {{ [key: string]: App.OSMEdge }} */
  let edges = {};

  // 例として、1つのノードと1つのエッジを作成する

  // "TestNode" という名前の ID のノードを作成し、座標は (0, 0) に設定する
  // 以下 2 行 (@type と const ... のある行) はセットで使う。
  /** @type {App.MapNode} */
  const testNode = {
    type: "MapNode", // 固定値
    id: "TestNode",
    coordinate: {
      lat: 0, // 緯度
      lng: 0 // 経度
    },
    edges: ["TestEdge"] // 隣接するエッジの ID の配列
  };

  // 作成したノードを nodes オブジェクトに追加する
  nodes["TestNode"] = testNode;

  // "TestEdge" という名前の ID のエッジを作成し、始点は "TestNode"、終点は "TestNode" に設定する
  // 以下 2 行 (@type と const ... のある行) はセットで使う。
  /** @type {App.OSMEdge} */
  const testEdge = {
    type: "OSMEdge", // 固定値
    id: "TestEdge",
    begin: "TestNode", // 始点のノード ID
    end: "TestNode", // 終点のノード ID

    highway: "residential", // 道路の種類
    width: 5, // 道路の幅
    sidewalk: "both", // 歩道の有無
  };

  console.log(nodes);
  console.log(edges);

  // 作成したエッジを edges オブジェクトに追加する
  edges["TestEdge"] = testEdge;

  // 返り値として OSM Graph を返す
  return {
    nodes,
    edges
  };
}