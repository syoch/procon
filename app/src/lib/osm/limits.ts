/**
 * 1 回の OSM 取得で扱うセル (1/64° 格子) 数の上限。
 * Overpass の 1 クエリに載るデータ量を抑え、広域表示での OOM を防ぐ。
 * 512 セルは 23×23 格子で、37°N ではおよそ 40km×32km に相当する。
 * 超える場合は取得せずに throw する。
 *
 * 仮の値。OOM の主因はセル数ではなく取得要素数なので、
 * `log_lines` の requested / fetch と取得要素数の実測で見直す。
 */
export const MAX_OSM_CELLS = 512;
