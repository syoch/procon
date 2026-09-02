/**
 * @brief コスト計算を行う
 * @param {App.FoldedEdge} folded_edge
 * @returns {App.ComputedEdge | Error} コスト計算後のエッジ
 */
export function CalculateCost(folded_edge) {
  /*道路座標とhighway属性，width属性，sidewalk属性を表示 */
  console.log({
    id: folded_edge.id,

    //   旧
    //     highway: osm_edge.highway,
    //     width: osm_edge.width,
    //     sidewalk: osm_edge.sidewalk,
    // (syoch)
    //   reorder-graph-transform ブランチのマージ時に変更を加えました。
    //   osm_edge を受け取る設計であったものから、 folded_edge を受け取る設計に変更したためです。
    //
    //   folded_edge.segments にコスト算出対象の道路情報のリストが格納されています。
    //   そのため、とりあえず folded_edge.segments[0] の highway, width, sidewalk を参照するように変更しました。
    highway: folded_edge.segments[0].highway,
    width: folded_edge.segments[0].width,
    sidewalk: folded_edge.segments[0].sidewalk,
  });

  return {
    type: "ComputedEdge",
    begin: folded_edge.begin,
    end: folded_edge.end,
    id: folded_edge.id,

    mix_score: 0,
    view_score: 0,
    width_score: 0,
  };
}
