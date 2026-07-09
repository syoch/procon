/**
 * @brief コスト計算を行う
 * @param {App.OSMEdge} osm_edge
 * @returns {App.ComputedEdge} コスト計算後のエッジ
 */
export function CalculateCost(osm_edge) {
  void osm_edge;
  //
  osm_edge.sidewalk;

  return {
    type: "ComputedEdge",
    begin: osm_edge.begin,
    end: osm_edge.end,
    id: osm_edge.id,
    
    mix_score: 0,
    view_score: 0,
    width_score: 0,
  };
}