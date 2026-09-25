import { getContext, setContext } from "svelte";

export interface LocationCandidate {
  /** 短い表示名(例: "長岡駅") */
  name: string;
  /** Nominatimの完全な住所文字列 */
  displayName: string;
  /** 緯度 */
  lat: number;
  /** 経度 */
  lon: number;
  /** OSMのclassタグ(例: "railway", "amenity") */
  category: string;
  /** OSMのtypeタグ(例: "station", "school") */
  type: string;
  /** [minLat, maxLat, minLon, maxLon] */
  boundingBox: [number, number, number, number];
}

export type LocationState = {
  state: "uninitialized" | "selected" | "confirmed"
  coordinate: App.Coordinate | null;
  query: string;
}

export type AppState = {
  begin: LocationState;
  end: LocationState;
  locationSelection: "begin" | "end" | null
}

export type LocationResolver = (query: string) => Promise<LocationCandidate[]>;

export class MainAppContext {
  locationResolver: LocationResolver;
  public state: AppState;

  constructor(locationResolver: LocationResolver) {
    this.locationResolver = locationResolver;
    this.state = $state<AppState>({
      begin: {
        state: "uninitialized",
        coordinate: null,
        query: "",
      },
      end: {
        state: "uninitialized",
        coordinate: null,
        query: "",
      },
      locationSelection: null,
    });
  }

  static getInstance(): MainAppContext {
    return getContext<MainAppContext>("MainAppContext");
  }

  static create(locationResolver: LocationResolver): MainAppContext {
    const instance = new MainAppContext(locationResolver);
    setContext("MainAppContext", instance);
    return instance;
  }
}