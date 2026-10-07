import { getContext, setContext } from "svelte";
import L from "leaflet";
import { queryParameters, ssp } from "sveltekit-search-params";
import type { Readable, Writable } from "svelte/store";
import type { ModeId } from "$lib/mode_rules";
import { debounce } from "$lib/utils/debounce";

/** 先読みを出してから実行するまでの待ち時間 [ms] */
const PRELOAD_DEBOUNCE_MS = 500;

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
  query: string;
  displayName?: string;
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
  /**
   * 移動モード (mode_rules.ts)。指定すると、通れる道・一方通行・急カーブの基準がサーバー側でモードごとに決まる。
   * 未指定のプリセットは従来どおり wayHighway で探索する
   */
  mode?: ModeId;
};

/** URL で共有する画面。`boot` は起動演出専用なので含めない。 */
const SHARED_SCREENS = ["app", "menu-detail", "menu-result"] as const;

/** `boot` 以外は URL で共有される。 */
export type Screen = "boot" | (typeof SHARED_SCREENS)[number];

export type LocationResolver = (query: string) => Promise<LocationCandidate[]>;
export type ParameterVariantProvider = () => ParameterVariant[];

const DEFAULT_ZOOM = 16;

/** 座標は `37.43915,138.87876` と簡潔にエンコードする。 */
const coordinate = () => ({
  encode: (value: App.Coordinate) =>
    `${value.lat.toFixed(5)},${value.lng.toFixed(5)}`,
  decode: (value: string | null): App.Coordinate | null => {
    if (!value) return null;
    const [lat, lng] = value.split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  },
});

/**
 * URL クエリに載せるページ状態。
 *
 * 戻り値を $state として $effect.pre を使うため、**モジュールトップレベルでは
 * 呼ばないこと**。`AppState` のコンストラクタ（= コンポーネント初期化時）からのみ。
 */
function createUrlState() {
  /**
   * 始点・終点・画面。履歴 entry を作るのでブラウザの「戻る」で操作を
   * 巻き戻せる。`defaultValue` は渡さない。渡すと absent なパラメータが
   * override に固定され、戻る/進むで URL が変わっても反映されなくなるため。
   */
  const share = queryParameters(
    { b: coordinate(), e: coordinate(), v: ssp.string() },
    { pushHistory: true, showDefaults: false, sort: true },
  );

  /**
   * 地図の viewpoint。ドラッグで連続的に変わるので履歴 entry を作らず、
   * ブラウザの履歴 API のレート制限に備えて debounce する。
   */
  const viewport = queryParameters(
    { z: ssp.number(), c: coordinate() },
    {
      pushHistory: false,
      showDefaults: false,
      sort: true,
      debounceHistory: 400,
    },
  );

  return { share, viewport };
}

/**
 * アプリケーション全体の状態。
 *
 * セッション内だけ有効な値 ($state) と、URL が唯一の情報源の値
 * (getter/setter) を同じ `ctx.state.*` というインターフェースで公開する。
 */
export class AppState {
  /** 選択可能なパラメータプリセット(車種) */
  parameterVariants: ParameterVariant[];

  /** 起動演出が終わったか。false の間 `appState` は "boot" を返す。 */
  booted = $state(false);

  #url = createUrlState();

  private session = $state({
    begin: { state: "uninitialized", query: "" } as LocationState,
    end: { state: "uninitialized", query: "" } as LocationState,
    locationSelection: null as "begin" | "end" | null,
    locationCandidates: null as LocationCandidate[] | null,
    selectedVariantIndex: 0,
  });

  constructor(
    parameterVariants: ParameterVariant[],
    selectedVariantIndex: number,
  ) {
    this.parameterVariants = parameterVariants;
    this.session.selectedVariantIndex = selectedVariantIndex;
  }

  get begin(): LocationState {
    return this.session.begin;
  }
  get end(): LocationState {
    return this.session.end;
  }
  get locationSelection(): "begin" | "end" | null {
    return this.session.locationSelection;
  }
  set locationSelection(value: "begin" | "end" | null) {
    this.session.locationSelection = value;
  }
  get locationCandidates(): LocationCandidate[] | null {
    return this.session.locationCandidates;
  }
  set locationCandidates(value: LocationCandidate[] | null) {
    this.session.locationCandidates = value;
  }
  /** 選択中プリセットの index (-1 は未選択) */
  get selectedVariantIndex(): number {
    return this.session.selectedVariantIndex;
  }
  set selectedVariantIndex(value: number) {
    this.session.selectedVariantIndex = value;
  }

  /** 現在の画面。`boot` は URL に載せない。 */
  get appState(): Screen {
    if (!this.booted) return "boot";
    const shared = this.#url.share.v;
    return SHARED_SCREENS.find((screen) => screen === shared) ?? "menu-detail";
  }
  set appState(screen: Screen) {
    this.#url.share.v = screen;
  }

  coordinate(target: "begin" | "end"): App.Coordinate | null {
    return target === "begin" ? this.#url.share.b : this.#url.share.e;
  }
  setCoordinate(target: "begin" | "end", value: App.Coordinate | null) {
    if (target === "begin") {
      this.#url.share.b = value;
    } else {
      this.#url.share.e = value;
    }
  }

  /**
   * 地図の viewpoint と URL を同期する。地図の生成後に 1 度だけ呼ぶ。
   * 復元（URL → 地図）と書き戻し（地図 → URL）の両方をここで受け持つ。
   *
   * 書き戻しは Leaflet のイベントハンドラから呼ぶため、この effect が
   * URL 状態に依存しても連鎖しない。
   * 戻り値は listener と未実行の先読みを破棄する。
   */
  bindMap(map: L.Map, onMoveEnd: () => void): () => void {
    // 地図が動き続けている間は先読みを出さず、最後の移動から 500ms 静まったら出す。
    // URL への書き戻しは即時のままにする。
    const requestPreload = debounce(onMoveEnd, PRELOAD_DEBOUNCE_MS);

    // 復元（共有リンク・リロード・戻る/進む）
    $effect(() => {
      const center = this.#url.viewport.c;
      const zoom = this.#url.viewport.z ?? DEFAULT_ZOOM;
      // 同じ位置なら setView しない。setView は moveend を発火するため、
      // 無条件に呼ぶと「書き戻し → setView → moveend」の連鎖になる。
      const current = map.getCenter();
      if (center && (current.lat !== center.lat || current.lng !== center.lng)) {
        map.setView([center.lat, center.lng], zoom);
      } else if (map.getZoom() !== zoom) {
        map.setZoom(zoom);
      }
    });

    // 書き戻し
    const save = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const current = this.#url.viewport.c;
      const unchanged =
        current?.lat === center.lat &&
        current.lng === center.lng &&
        (this.#url.viewport.z ?? DEFAULT_ZOOM) === zoom;
      if (!unchanged) {
        this.#url.viewport.c = { lat: center.lat, lng: center.lng };
        this.#url.viewport.z = zoom;
      }
      requestPreload();
    };
    // whenReady には書き戻さない。地図が既に ready なら同期実行され、
    // 復元 effect より先に URL を既定値で上書きし、さらに呼び出し元
    // の effect に URL 状態を依存させてしまう。初期の書き戻しは復元
    // effect の setView/setZoom が moveend を発火して起こる。
    map.whenReady(requestPreload);
    map.on("moveend", save);

    return () => {
      requestPreload.cancel();
      map.off("moveend", save);
    };
  }
}

export class MainAppContext {
  locationResolver: LocationResolver;
  public state: AppState;

  constructor(
    locationResolver: LocationResolver,
    parameterVariants: ParameterVariant[],
    selectedVariantIndex: number
  ) {
    this.locationResolver = locationResolver;
    // AppState のコンストラクタが $effect.pre を使うため、
    // ここは必ずコンポーネント初期化時に呼ぶこと。
    this.state = new AppState(parameterVariants, selectedVariantIndex);
  }

  get searchParameters(): App.SearchParameters {
    const params = this.state.parameterVariants[
      this.state.selectedVariantIndex
    ];
    if (!params) throw "無効なプリセットインデックスが指定されています";

    return params;
  }

  /** 選択中のプリセットの移動モード (未指定なら undefined) */
  get searchMode(): ModeId | undefined {
    return this.state.parameterVariants[this.state.selectedVariantIndex]?.mode;
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
