import { type Boundary } from "./boundary";
import { type OSMData } from "./osm-data";



export type OSMFetcher = (boundaries: Boundary[]) => Promise<OSMData>;

export type OSMCacheManager = {
  saveCache: (bound: Boundary, map: OSMData) => Promise<void>;
  readCache: (bound: Boundary) => Promise<OSMData | null>;
};

