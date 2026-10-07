/**
 * `/api/path-find` の応答の契約型
 */

import type { SharpTurn } from "$lib/sharp_turn";
import type { WidthCoverage } from "$lib/road_width";

/** 探索そのものの結果 */
type PathFindOutcome =
    | {
        found: false;
        /** 見つからなかった理由 */
        reason: "BEGIN_UNREACHABLE" | "END_UNREACHABLE" | "NO_ROUTE";
        /** ユーザーに表示するメッセージ */
        message: string;
    }
    | {
        found: true;
        coords: App.Coordinate[];
        totalDistance: number;
        totalIntersections: number;
        /** 経路上の急カーブ (道の途中のカーブのみ。検出しないモードでは空) */
        sharpTurns: SharpTurn[];
        /** 指定された始点・終点から、吸着した道の上の点までの距離 [m] */
        snapDistance: { begin: number; end: number };
        /**
         * 経路の幅員の網羅率 (経路の区間のうち車両が通る道で、幅が分かっている区間の割合)。
         * 国土地理院のタイルが取れなかった範囲では幅の制限が効かないため、キャッシュの有無で結果が変わりうることを観測するためのもの
         */
        widthCoverage: WidthCoverage;
        infoGraph: App.InformationGraph;
    };

/**
 * `/api/path-find` の応答。探索結果に、リクエスト単位の地図データの取得状況を足す。
 *
 * `osmPartial` は探索の成否とは別の情報にする。
 * `found: false` の `reason` は「経路が無い理由」の有限の分類で、データ欠損とは独立に決まる。
 * 経路が見つかってもデータは欠けうるので、`reason` / `message` には埋め込まない。
 */
export type PathFindResult = PathFindOutcome & {
    /** 地図データを一部しか取得できなかったか (取得量・時間の上限に達した) */
    osmPartial?: boolean;
};
