import { distanceOf } from "./utils/haversine";
import { scoreMix, scoreWidth } from "./mode_scoring";

/**
 * @brief コスト計算を行う
 * @param {App.FoldedEdge} folded_edge
 * @param {import("./mode_scoring").ScoringProfile} [scoring] 移動モードごとのスコアの定義 (省略時は全モード共通の計算)
 * @returns {App.ComputedEdge | Error} //コスト計算後のエッジ
 */
export function CalculateCost(folded_edge, scoring) {
  let widthScore = 0; // 幅員スコア
  let mixScore = 0; // 混在スコア(歩行者と自転車の混在度)
  let viewScore = 0; // 視界スコア

  if (folded_edge.type === "FoldedEdge") {
    /** @type {App.Segment[]} */
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
    // モードごとの定義があり、幅が分かる場合はそちらを使う (mode_scoring.ts)
    widthScore = scoreWidth(scoring, averageWidth) ?? calculateWidthScore(averageWidth, primaryHighway);

    /* 混在スコアの計算 */
    // モードごとの定義があり、歩道タグが無い場合はそちらを使う (mode_scoring.ts)
    mixScore = scoreMix(scoring, primarySidewalk, primaryHighway) ?? calculateMixScore(primarySidewalk, primaryHighway);

    /* 視界スコアの計算 */
    viewScore = calculateViewScore(folded_edge,primaryHighway);

    /* 計算結果を表示 */
    /* console.log("scores",{
      id: folded_edge.id,
      widthScore: widthScore,
      mixScore: mixScore,
      viewScore: viewScore,
    }); */
    /*folded_edgeの表示*/
    /* console.log("FoldedEdge", {
      id: folded_edge.id, 
      begin: folded_edge.begin,
      end: folded_edge.end,
      first_segments_begin: folded_edge.segments[0].begin_coordinate,
      first_segments_end: folded_edge.segments[0].end_coordinate,
      last_segments_begin: folded_edge.segments[folded_edge.segments.length - 1].begin_coordinate,
      last_segments_end: folded_edge.segments[folded_edge.segments.length - 1].end_coordinate,
    }); */


    // --- 3. computedEdge の生成 ---
    /** @type {App.ComputedEdge} */
    const computedEdge = {
      type: "ComputedEdge",
      id: folded_edge.id,
			begin: folded_edge.begin,
			end: folded_edge.end,
      width_score: widthScore,
      view_score: viewScore,
      mix_score: mixScore,
      // path_finder は segments から距離を計算し、direction で通行可否を判定する
      segments: folded_edge.segments,
      direction: folded_edge.direction,
    };

    /* ComputedEdgeを表示 */
    /*
    console.log("ComputedEdge", {
    type: computedEdge.type,
          id: computedEdge.id,
			begin: computedEdge.begin,
			end: computedEdge.end,
    width_score: computedEdge.width_score,
    mix_score: computedEdge.mix_score,
    view_score: computedEdge.view_score,
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
 * @param {App.Segment[]} segments
 * @param {keyof App.Segment} key
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
 * @param {App.Segment[]} segments
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
      case "motorway":
        return 1.0; // 高速道路
      case "trunk":
        return 0.9; // 幹線道路
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
    return 1.0; // 6m以上：非常に安全
  } else if (width >= 3.0) {
    return 0.7; // 3m以上：普通
  } else {
    return 0.1; // 狭い
  }
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
        return 1.0; // 高速道路(歩行者・自転車禁止)
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
 * 視界スコア・道の曲率計算
 * @param {App.FoldedEdge} folded_edge
 * @param {string | undefined} primary_highway
 * @returns {number}
 */
function calculateViewScore(folded_edge,primary_highway) {
  if(folded_edge.segments.length < 2){
    /* console.log("folded_edgeのセグメントが1つしかないため、視界スコアを最大値に設定します。"); */
    return 1.0; // 直線道路の場合は視界スコアを最大値に設定
  }
  const scores = [];
  for(let i=0;i<folded_edge.segments.length-1;i++){
    let vec1x,vec1y,vec2x,vec2y;

    const firstSeg = folded_edge.segments[i];
    const nextSeg = folded_edge.segments[i + 1];
    
    if(firstSeg.end_coordinate.lng === nextSeg.begin_coordinate.lng && firstSeg.end_coordinate.lat === nextSeg.begin_coordinate.lat){
      vec1x=firstSeg.begin_coordinate.lng - firstSeg.end_coordinate.lng;
      vec1y=firstSeg.begin_coordinate.lat - firstSeg.end_coordinate.lat;
      vec2x=nextSeg.end_coordinate.lng - nextSeg.begin_coordinate.lng;
      vec2y=nextSeg.end_coordinate.lat - nextSeg.begin_coordinate.lat;
    } else if(firstSeg.begin_coordinate.lng === nextSeg.begin_coordinate.lng && firstSeg.begin_coordinate.lat === nextSeg.begin_coordinate.lat){
      vec1x=firstSeg.end_coordinate.lng - firstSeg.begin_coordinate.lng;
      vec1y=firstSeg.end_coordinate.lat - firstSeg.begin_coordinate.lat;
      vec2x=nextSeg.end_coordinate.lng - nextSeg.begin_coordinate.lng;
      vec2y=nextSeg.end_coordinate.lat - nextSeg.begin_coordinate.lat;
    } else if(firstSeg.begin_coordinate.lng === nextSeg.end_coordinate.lng && firstSeg.begin_coordinate.lat === nextSeg.end_coordinate.lat){
      vec1x=firstSeg.end_coordinate.lng - firstSeg.begin_coordinate.lng;
      vec1y= firstSeg.end_coordinate.lat - firstSeg.begin_coordinate.lat;
      vec2x=nextSeg.begin_coordinate.lng - nextSeg.end_coordinate.lng;
      vec2y=nextSeg.begin_coordinate.lat - nextSeg.end_coordinate.lat;
    } else if(firstSeg.end_coordinate.lng === nextSeg.end_coordinate.lng && firstSeg.end_coordinate.lat === nextSeg.end_coordinate.lat){
      vec1x=firstSeg.begin_coordinate.lng - firstSeg.end_coordinate.lng;
      vec1y=firstSeg.begin_coordinate.lat - firstSeg.end_coordinate.lat;
      vec2x=nextSeg.begin_coordinate.lng - nextSeg.end_coordinate.lng;
      vec2y=nextSeg.begin_coordinate.lat - nextSeg.end_coordinate.lat;
    } else {
      console.warn("folded_edgeのセグメントが連結されていません。");
      return 0; //セグメントが連結されていない場合は視界スコアを0に設定
    }
 // --- 2. 高速内積計算（関数呼び出しオーバーヘッドの削減） ---
    const dot = vec1x * vec2x + vec1y * vec2y;
    const mag1 = Math.sqrt(vec1x * vec1x + vec1y * vec1y);
    const mag2 = Math.sqrt(vec2x * vec2x + vec2y * vec2y);

    if (mag1 === 0 || mag2 === 0) {
      scores.push(1.0);
      continue;
    }

    // 角度（ラジアン）の計算: 直進時 (angle = 0) となるよう Math.PI から減算
    const cosAngle = Math.min(Math.max(dot / (mag1 * mag2), -1), 1);
    const angle = Math.PI - Math.acos(cosAngle);

    // 距離の計算: Leaflet を使い前後のセグメント長の平均を算出
    const firstnode1 = firstSeg.begin_coordinate;
    const firstnode2 = firstSeg.end_coordinate;
    const nextnode1 = nextSeg.begin_coordinate;
    const nextnode2 = nextSeg.end_coordinate;
    const distance = (distanceOf(firstnode1,firstnode2) + distanceOf(nextnode1, nextnode2)) / 2;

    if (distance > 0) {
      const curv = angle / distance;
      const currentHighway = firstSeg.highway;
      scores.push(curvature_ratio(curv, currentHighway, primary_highway));
    } else {
      console.warn("距離が0以下のため、視界スコアを最大値に設定します。");
      scores.push(1.0);
    }
  }

  if (scores.length === 0) return 1.0;
  //scoresから平均値を計算する
  const aveScore = scores.reduce((sum, val) => sum + val, 0) / scores.length;
  // 配列の中から最小値（一番低いスコア＝一番急なカーブ）を取得
  const minScore = Math.min(...scores);

  const score=(minScore+aveScore)/2

  return score; //後に日本の道路設計基準よりスコア調整する予定
}

/**
 * 視界スコア・道の曲率計算
 * @param {number} curv
 * @param {string | undefined} highway
 * @param {string | undefined} primary_highway
 * @returns {number}
 */
function curvature_ratio(curv, highway,primary_highway) {
  let standard_curv=0;

  switch (highway) {
    case "motorway":
       standard_curv=1/570; // 高速道路(歩行者・自転車禁止)
        break;
      case "trunk":
      standard_curv=1/380;
      break;
    case "primary":
      standard_curv=1/230;
      break;
    case "secondary":
      standard_curv=1/120;
      break;
    case "tertiary":
      standard_curv=1/80;
      break;
    case "unclassified":
      standard_curv=1/50;
      break;
    case "residential":
    case "service":
    case "track":
      standard_curv=1/30;
      break;
    default:
      switch (primary_highway) {
        case "motorway":
          standard_curv=1/570; // 高速道路(歩行者・自転車禁止)
          break;
        case "trunk":
          standard_curv=1/380;
          break;
        case "primary":
          standard_curv=1/230;
          break;
        case "secondary":
          standard_curv=1/120;
          break;
        case "tertiary":
          standard_curv=1/80;
          break;
        case "unclassified":
          standard_curv=1/50;
          break;
        case "residential":
        case "service":
        case "track":
          standard_curv=1/30;
          break;
        default:
          standard_curv = 1/30; //safe fallback (ゼロ除算防止)
          break;
        }
      }
  const score=1.0-curv/standard_curv;
  return Math.min(1.0, Math.max(0.0, score));
}