import { type Boundary } from "./boundary";

export type OSMFetcher = (boundaries: Boundary[]) => Promise<App.OSMData>;

export type OSMCacheManager = {
  saveCache: (bound: Boundary, map: App.OSMData) => Promise<void>;
  readCache: (bound: Boundary) => Promise<App.OSMData | null>;
};

