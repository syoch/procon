/**
 * @typedef {Object} Segment
 * @property {{lat: number, lng: number}} [begin_coordinate]
 * @property {{lat: number, lng: number}} [end_coordinate]
 * @property {string} [highway]
 * @property {number} [width]
 * @property {string} [sidewalk]
 */

/**
 * @typedef {App.FoldedEdge & {
 *   primaryHighway?: string,
 *   primarySidewalk?: string,
 *   averageWidth?: number,
 *   widthScore: number,
 *   mixScore: number,
 *   viewScore: number,
 *   totalScore: number
 * }} ComputedEdge
 */

/**
 * @brief コスト計算を行う
 * @param {App.FoldedEdge} folded_edge
 * @returns {ComputedEdge | Error} //コスト計算後のエッジ
 */
export function CalculateCost(folded_edge) {
  let widthScore = 0; // 幅員スコア
  let mixScore = 0;   // 混在スコア(歩行者と自転車の混在度)
  let viewScore = 0;  // 視界スコア
  let totalScore = 0;

  if (folded_edge.type === "FoldedEdge") {
    /** @type {Segment[]} */
    const segments = folded_edge.segments || [];

    // --- 1. 各属性の統計（代表値・平均値）を計算 ---
    const primaryHighway = getMostFrequentAttribute(segments, "highway");
    const primarySidewalk = getMostFrequentAttribute(segments, "sidewalk");
    const averageWidth = calculateAverageWidth(segments);

    /* 集計結果の表示 */
    /*
    console.log({
      "FoldedEdge.": true,
      id: folded_edge.id,
      segmentCount: segments.length,
      highway: primaryHighway,   // 最も多く登場した highway
      width: averageWidth,       // width の平均値 (数値または undefined)
      sidewalk: primarySidewalk, // 最も多く登場した sidewalk
    });
    */

    // --- 2. 代表値・平均値を使った各種スコアの計算 ---
    /* 振幅スコアの計算 */
    widthScore = calculateWidthScore(averageWidth, primaryHighway);

    /* 混在スコアの計算 */
    mixScore = calculateMixScore(primarySidewalk, primaryHighway);

    /* 視界スコアの計算 */
    viewScore = calculateViewScore(primaryHighway);

    /* 合計スコアの計算 */
    totalScore = widthScore + mixScore + viewScore;

    /* 計算結果を表示 */
    console.log({
      "FoldedEdge.Calculated": true,
      id: folded_edge.id,
      widthScore: widthScore,
      mixScore: mixScore,
      viewScore: viewScore,
      totalScore: totalScore,
    });

    // --- 3. computedEdge の生成 ---
    // 元の folded_edge (id, begin, end, segments/座標データ等) に
    // 集計値と計算スコアをすべて統合する
    /** @type {ComputedEdge} */
    const computedEdge = {
      ...folded_edge,
      primaryHighway: primaryHighway,   // 集計した最頻値(highway)
      primarySidewalk: primarySidewalk, // 集計した最頻値(sidewalk)
      averageWidth: averageWidth,       // 平均値(width)
      widthScore: widthScore,           // 計算された幅スコア
      mixScore: mixScore,               // 計算された混在スコア
      viewScore: viewScore,             // 計算された視界スコア
      totalScore: totalScore,           // トータルコスト(合計スコア)
    };

    /* ComputedEdgeを表示 */
    /* 
    console.log("ComputedEdge Result:", {
    id: computedEdge.id,
    begin: computedEdge.begin,
    end: computedEdge.end,
    type: computedEdge.type,
    primaryHighway: computedEdge.primaryHighway, 
    primarySidewalk: computedEdge.primarySidewalk,
    averageWidth: computedEdge.averageWidth,
    widthScore: computedEdge.widthScore,
    mixScore: computedEdge.mixScore,
    viewScore: computedEdge.viewScore,
    totalScore: computedEdge.totalScore,
    segments: computedEdge.segments,
    });
    */

    return computedEdge;
  }

  return new Error("Invalid edge type. Expected FoldedEdge.");
}

// -------------------------------------------------------------
// 【集計用ヘルパー関数】
// -------------------------------------------------------------

/**
 * segments 配列の中から指定キーの「最も出現頻度が高い値（最頻値）」を取得する
 * @param {Segment[]} segments
 * @param {keyof Segment} key
 * @returns {string | undefined}
 */
function getMostFrequentAttribute(segments, key) {
  /** @type {Record<string, number>} */
  const counts = {};

  for (const seg of segments) {
    const val = seg[key];
    if (typeof val === "string") {
      counts[val] = (counts[val] || 0) + 1;
    }
  }

  let mostFrequent = undefined;
  let maxCount = 0;

  for (const [val, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      mostFrequent = val;
    }
  }

  return mostFrequent;
}

/**
 * segments 配列の中から数値形式の width の平均値を計算する
 * @param {Segment[]} segments
 * @returns {number | undefined}
 */
function calculateAverageWidth(segments) {
  let sum = 0;
  let count = 0;

  for (const seg of segments) {
    if (typeof seg.width === "number" && !isNaN(seg.width) && seg.width > 0) {
      sum += seg.width;
      count++;
    }
  }

  return count > 0 ? sum / count : undefined;
}

/**
 * 幅員スコアの計算
 * @param {number | undefined} width
 * @param {string | undefined} highway
 * @returns {number}
 */
function calculateWidthScore(width, highway) {
  if (!width) {
    // widthが未定義の場合はhighway属性から推定
    switch (highway) {
      case "motorway":    return 1.2; // 高速道路
      case "trunk":       return 1.0; // 幹線道路
      case "primary":     return 0.8; // 主要国道
      case "secondary":   return 0.6; // 国道・主要地方道
      case "tertiary":    return 0.4; // 一般主要道
      case "unclassified":return 0.3; // 一般道
      case "residential": return 0.1; // 住宅街の道路
      default:            return 0.3; // 不明な場合(遊歩道も考慮したほうがいいかも)
    }
  }
  if (width >= 6.0) {
    return 1.0; // 6m以上：非常に安全
  } else if (width >= 3.0) {
    return 0.7;// 3m以上：普通
  } else{
    return 0.1; // 狭い
  }  /*lanes属性（車線数）というデータがあるらしい。そこから予測もできるかも。 */
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
      case "motorway":    return 1.2; // 高速道路(歩行者・自転車禁止)
      case "trunk":
      case "primary":
      case "secondary":
      case "tertiary":    return 0.8; // 一般主要道(歩道あり・自転車通行可)
      case "unclassified":
      case "residential": return 0.3; // 一般道・住宅街の道路(路側帯があることが多い道路)
      default:            return 0.1; // 不明な場合
    }
  }
  switch (sidewalk) {
    case "both":     return 0.8; // 両側に歩道あり
    case "left":
    case "right":
    case "separate": return 0.6; // 片側または独立歩道
    case "none":     return 0.3; // 歩道なし
    default:         return 0.5;
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
    case "footway": return 1.0;
    case "residential": return 0.8;
    case "primary":
    case "secondary": return 0.4;
    default: return 0.5;
  }
}