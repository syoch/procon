import { getContext, setContext } from "svelte";
import type { Readable, Writable } from "svelte/store";

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
  state: "uninitialized" | "selected" | "confirmed";
  coordinate: App.Coordinate | null;
  query: string;
};

/**
 * 探索パラメータのプリセット(車種など)。
 * それぞれの重みが経路コスト計算に使われる。
 */
export type ParameterVariant = {
  /** 表示名(例: "徒歩", "自転車", "車") */
  name: string;
  /** 距離ペナルティ係数 */
  lambda: number;
  /** 道幅スコアの重み */
  mix_score_weight: number;
  /** 眺望スコアの重み */
  view_score_weight: number;
  /** 道幅スコアの重み */
  width_score_weight: number;
};

export type AppState = {
  begin: LocationState;
  end: LocationState;
  locationSelection: "begin" | "end" | null;
  locationCandidates: LocationCandidate[] | null;
  /** 選択可能なパラメータプリセット(車種) */
  parameterVariants: ParameterVariant[];
  /** 選択中プリセットの index (-1 は未選択) */
  selectedVariantIndex: number;

  appState: "boot" | "app" | "menu-detail" | "menu-result"
};

export type LocationResolver = (query: string) => Promise<LocationCandidate[]>;
export type ParameterVariantProvider = () => ParameterVariant[];

export class MainAppContext {
  locationResolver: LocationResolver;
  public state: AppState;

  constructor(
    locationResolver: LocationResolver,
    parameterVariants: ParameterVariant[],
    selectedVariantIndex: number
  ) {
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
      locationCandidates: null,
      parameterVariants,
      selectedVariantIndex: selectedVariantIndex,
      appState: "boot"
    });
  }

  get searchParameters(): App.SearchParameters {
    const params = this.state.parameterVariants[this.state.selectedVariantIndex];
    if (!params) throw "無効なプリセットインデックスが指定されています";

    return params;
  }

  static getInstance(): MainAppContext {
    return getContext<MainAppContext>("MainAppContext");
  }

  static create(
    locationResolver: LocationResolver,
    parameterVariants: ParameterVariant[],
    selectedVariantIndex: number,
  ): MainAppContext {
    const instance = new MainAppContext(locationResolver, parameterVariants, selectedVariantIndex);
    setContext("MainAppContext", instance);
    return instance;
  }
}
