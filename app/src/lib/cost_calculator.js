/**
 * @brief コスト計算を行う
 * @param {App.OSMEdge} osm_edge
 * @returns {App.ComputedEdge | Error} コスト計算後のエッジ
 */
export function CalculateCost(osm_edge) {
  /*道路座標とhighway属性，width属性，sidewalk属性を表示 */
  console.log({
    id: osm_edge.id,
    highway: osm_edge.highway,
    width: osm_edge.width,
    sidewalk: osm_edge.sidewalk
  });



  return new Error("CalculateCost 関数は未実装です");
}