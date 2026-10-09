import { type Boundary } from "./boundary";

export type OSMFetcher = (boundaries: Boundary[]) => Promise<App.OSMData>;

/**
 * 1 つの endpoint へ投げる低レベルの取得。
 * endpoint を引数で受けるので、env も coverage も知らない。
 */
export type OverpassEndpointFetcher = (endpoint: string, boundaries: Boundary[]) => Promise<App.OSMData>;

export type OSMCacheManager = {
  saveCache: (bound: Boundary, map: App.OSMData) => Promise<void>;
  readCache: (bound: Boundary) => Promise<App.OSMData | null>;
};

