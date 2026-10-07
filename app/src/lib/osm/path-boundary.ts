import { deltaLatitude, deltaLongitude } from "./grid";

/**
 * 始点・終点を囲む範囲に足す余白 (格子のマス数)
 * 余白が無いと、範囲の外を回る道 (山道など) が切れて道路網から切り離されたり、
 * 範囲の外で交わる道が見えず交差点をカーブと誤判定したりするため
 */
const BOUNDARY_MARGIN_CELLS = 1;

/**
 * 経路探索に使う地図データの範囲を求める
 *
 * 端点先読み (`/api/preload-osm`) も同じ関数を使う。
 * 先読みする範囲と経路探索が読む範囲を一致させ、キャッシュを温める。
 */
export function getBoundaryBox(begin: App.Coordinate, end: App.Coordinate): {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
} {
    return {
        minLat: (Math.floor(Math.min(begin.lat, end.lat) / deltaLatitude) - BOUNDARY_MARGIN_CELLS) * deltaLatitude,
        minLng: (Math.floor(Math.min(begin.lng, end.lng) / deltaLongitude) - BOUNDARY_MARGIN_CELLS) * deltaLongitude,
        maxLat: (Math.ceil(Math.max(begin.lat, end.lat) / deltaLatitude) + BOUNDARY_MARGIN_CELLS) * deltaLatitude,
        maxLng: (Math.ceil(Math.max(begin.lng, end.lng) / deltaLongitude) + BOUNDARY_MARGIN_CELLS) * deltaLongitude,
    }
}
