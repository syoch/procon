/**
 * `/api/path-find` の応答の契約型
 */

import type { SharpTurn } from "$lib/sharp_turn";
import type { WidthCoverage } from "$lib/road_width";

/** /api/path-find の応答 */
export type PathFindResult =
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
