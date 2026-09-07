/**
 * @brief コスト計算を行う
 * @param {App.FoldedEdge} folded_edge
 * @returns {App.ComputedEdge | Error} コスト計算後のエッジ
 */
export function CalculateCost(folded_edge) {
  let widthScore = 0; //振幅スコア
  let mixScore = 0; //混在スコア(歩行者と自転車の混在度)
  let viewScore = 0; //視界スコア
  let totalScore = 0;
  /*道路座標とhighway属性，width属性，sidewalk属性を表示 */
  if (folded_edge.type === "FoldedEdge") {
    console.log({
      "FoldedEdge.": true,
      id: folded_edge.id,
      highway: folded_edge.segments[0]?.highway,
      width: folded_edge.segments[0]?.width,
      sidewalk: folded_edge.segments[0]?.sidewalk,
    });

    /*振幅スコアの計算 */
    widthScore = calculateWidthScore(
      folded_edge.segments[0]?.width,
      folded_edge.segments[0]?.highway,
    );

    /*混在スコアの計算 */
    mixScore = calculateMixScore(
      folded_edge.segments[0]?.sidewalk,
      folded_edge.segments[0]?.highway,
    );

    /*視界スコアの計算 */
    viewScore = calculateViewScore(folded_edge.type);

    /*合計スコアの計算 */
    totalScore = widthScore + mixScore + viewScore;

    /*計算結果を表示 */
    console.log({
      "FoldedEdge.Calculated": true,
      id: folded_edge.id,
      widthScore: widthScore,
      mixScore: mixScore,
      viewScore: viewScore,
      totalScore: totalScore,
    });

    // そのまま FoldedEdge を返す
    return folded_edge;
  }
}

/**
 * 振幅スコアの計算
 * @param {number | undefined} width
 * @param {string | undefined} highway
 * @returns {number}
 */
function calculateWidthScore(width, highway) {
  if (!width) {
    // widthが未定義の場合はhighway属性から推定
    switch (highway) {
      case "motorway":
        return 1.2; // 高速道路
      case "trunk":
        return 1.0; // 幹線道路
      case "primary":
        return 0.8; // 主要国道
      case "secondary":
        return 0.6; // 国道・主要地方道
      case "tertiary":
        return 0.4; // 一般主要道
      case "unclassified":
        return 0.3; // 一般道
      case "residential":
        return 0.1; // 住宅街の道路
      default:
        return 0.3; // 不明な場合(遊歩道も考慮したほうがいいかも)
    }
  }
  if (width >= 6.0) {
    return 1.0;
  } // 6m以上：非常に安全
  else if (width >= 3.0) {
    return 0.7;
  } // 3m以上：普通
  return 0.1; // 狭い

  /*lanes属性（車線数）というデータがあるらしい。
  そこから予測もできるかも。 */
}

/**
 * 混在スコアの計算
 * @param {string | undefined} sidewalk
 * @param {string | undefined} highway
 * @returns {number}
 */
function calculateMixScore(sidewalk, highway) {
  if (!sidewalk) {
    // sidewalkが未定義の場合はhighway属性から推定
    switch (highway) {
      case "motorway":
        return 1.2; // 高速道路(歩行者・自転車禁止)
      case "trunk":
      case "primary":
      case "secondary":
      case "tertiary":
        return 0.8; // 一般主要道(歩道あり・自転車通行可)
      case "unclassified":
      case "residential":
        return 0.3; // 一般道・住宅街の道路(路側帯があることが多い道路)
      default:
        return 0.1; // 不明な場合
    }
  }
  switch (sidewalk) {
    case "both":
      return 0.8; // 両側に歩道あり
    case "left":
    case "right":
    case "separate":
      return 0.6; // 片側または独立歩道
    case "none":
      return 0.3; // 歩道なし
    default:
      return 0.5;
  }
}

/**
 * 視界スコアの計算
 * @param {string | undefined} mapEdge
 * @returns {number}
 */
function calculateViewScore(mapEdge) {
  switch (mapEdge) {
    case "pedestrian":
    case "footway":
      return 1.0; // 歩行者専用道路
    case "residential":
      return 0.8; // 住宅街の道路
    case "primary":
    case "secondary":
      return 0.4; // 交通量の多い幹線道路
    default:
      return 0.5;
  }
}
