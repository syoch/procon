/**
 * 移動モードごとの経路差を比べる CLI。
 *
 * #85（モードごとのスコアの見直し）の検証手段。
 * 同じ始点・終点で 5 モードを探索し、経路がモードごとに変わるかを表にして出す。
 *
 * 時間を測る bench（`run.ts` の SCENARIOS）には含めない。
 * 理由は [`README.md`](./README.md) の「モードごとの経路差の比較」に書いてある。
 *
 * 使い方:
 *   node bench/build.mjs
 *   node bench/.build/compare-modes.mjs
 *   node bench/.build/compare-modes.mjs --begin 37.4448,138.8537 --end 37.4326,138.9042
 *   node bench/.build/compare-modes.mjs --no-gsi
 *   node bench/.build/compare-modes.mjs --modes walk,bicycle,truck --json /tmp/modes.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CrossConvert } from "../src/lib/cross_transform";
import { fold2DegreeEdges } from "../src/lib/fold2degree";
import { transformOSMMapToOSMGraph } from "../src/lib/osm/graph";
import { pathFind } from "../src/lib/path_finder";
import { largestComponentEdges } from "../src/lib/utils/graph";
import { transientSplit } from "../src/lib/transient-split";
import {
  applyGsiWidths,
  GsiRoadIndex,
  measureSegmentsWidthCoverage,
  removeNarrowEdges,
  type WidthCoverage,
} from "../src/lib/road_width";
import type { GsiRoadSegment } from "../src/lib/gsi/parse";
import { distanceOf } from "../src/lib/utils/haversine";
import { MODE_IDS, MODE_PROFILES } from "../src/lib/mode_profiles";
import type { ModeId, ModeProfile } from "../src/lib/mode_rules";
import { trimOSMDataByMode } from "../src/lib/osm/osm-data";
import {
  requireGsiRoadSegmentsForTiles,
  tileKey,
  tilesAlongPath,
  type GsiTile,
} from "../src/lib/gsi";
import { gsiCacheManager } from "../src/lib/gsi/fs-cache-manager";
import { fetchGsiRoadTile } from "../src/lib/gsi/gsi-fetcher";
import {
  MAX_GSI_PASSES,
  MAX_SNAP_DISTANCE_M,
  countPassedIntersections,
  pathToCoordinates,
  pathToNodeIds,
} from "../src/routes/api/path-find/pathFind";
import { clone } from "./lib/harness";
import { fixtureBoundary, loadFixture } from "./lib/data";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 既定の始点・終点。フィクスチャ（長岡市中心部）の内側に収まる 2 点 */const DEFAULT_BEGIN: App.Coordinate = { lat: 37.4448, lng: 138.8537 }; // 長岡駅
const DEFAULT_END: App.Coordinate = { lat: 37.4326, lng: 138.9042 }; // 長岡プラ不像

type Options = {
  begin: App.Coordinate;
  end: App.Coordinate;
  modes: ModeId[];
  /** 一致率の基準にするモード */
  reference: ModeId;
  /** 国土地理院の幅員を使うか */
  gsi: boolean;
  /** 国土地理院タイルのファイルキャッシュ先 */
  gsiCacheDir: string;
  /** 結果をこのパスに JSON で書き出す */
  json?: string;
};

function parseCoordinate(text: string, label: string): App.Coordinate {
  const parts = text.split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) {
    throw new Error(`${label} は "緯度,経度" の形で指定します: ${text}`);
  }
  return { lat: parts[0], lng: parts[1] };
}

function parseMode(text: string): ModeId {
  const mode = text.trim();
  if (!MODE_IDS.includes(mode as ModeId)) {
    throw new Error(`移動モードが不明です: ${text} (候補: ${MODE_IDS.join(", ")})`);
  }
  return mode as ModeId;
}

function parseModes(text: string): ModeId[] {
  const modes = text.split(",").map((m) => m.trim()).filter((m) => m !== "");
  if (modes.length === 0) throw new Error("--modes が空です");
  return modes.map(parseMode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    begin: DEFAULT_BEGIN,
    end: DEFAULT_END,
    modes: [...MODE_IDS],
    reference: "car",
    gsi: true,
    gsiCacheDir: resolve(HERE, "gsi-cache"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} に値がありません`);
      return value;
    };
    switch (arg) {
      case "--begin":
        options.begin = parseCoordinate(next(), "--begin");
        break;
      case "--end":
        options.end = parseCoordinate(next(), "--end");
        break;
      case "--modes":
        options.modes = parseModes(next());
        break;
      case "--reference":
        options.reference = parseMode(next());
        break;
      case "--gsi-cache-dir":
        options.gsiCacheDir = resolve(next());
        break;
      case "--no-gsi":
        options.gsi = false;
        break;
      case "--json":
        options.json = resolve(next());
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`不明な引数: ${arg}`);
    }
  }
  if (!options.modes.includes(options.reference)) {
    throw new Error(`--reference の ${options.reference} が --modes に含まれていません`);
  }
  return options;
}

function printUsage() {
  console.log(`使い方: pnpm bench:modes [オプション]

  --begin <lat,lng>      始点 (既定 ${DEFAULT_BEGIN.lat},${DEFAULT_BEGIN.lng} = 長岡駅)
  --end <lat,lng>        終点 (既定 ${DEFAULT_END.lat},${DEFAULT_END.lng} = 長岡プラ不像)
  --modes <a,b,...>      比較するモード (既定 ${MODE_IDS.join(",")})
  --reference <mode>     一致率の基準にするモード (既定 car)
  --no-gsi               国土地理院の幅員を使わずに探索する
  --gsi-cache-dir <dir>  国土地理院タイルのキャッシュ先 (既定 bench/.build/gsi-cache)
  --json <path>          結果を JSON で書き出す
  -h, --help             この表示

一致率は「経路が使う FoldedEdge (= OSM の way) の集合が、短い方の経路と何割一致するか」。
道そのものはモードをまたいで同じ id を持つのでこれで比べられる。
交差点内部の MapVCrossEdge は隣接ノードがそのモードのグラフに含まれるかどうかで id が変わるため数えない。

  始点・終点は OSM キャッシュ（OSM_CACHE_DIR）のセル範囲の内側を指定する。
  範囲外の点は探索できない。セルは先に node bench/.build/fetch-fixture.mjs で取得する。`);
}

type SearchResult = {
  mode: ModeId;
  found: boolean;
  reason?: string;
  message?: string;
  /** 経路が使う FoldedEdge の id (= OSM の way id) */
  wayIds: string[];
  distance: number;
  intersections: number;
  snapDistance?: { begin: number; end: number };
  widthCoverage?: WidthCoverage;
  /** 幅員を補った区間数 */
  widthApplied?: number;
  /** 幅が足りなくて取り除いた区間数 */
  narrowRemoved?: number;
  graphNodes?: number;
  graphEdges?: number;
  gsiPasses?: number;
  gsiTiles?: number;
};

function totalDistance(coords: App.Coordinate[]): number {
  let distance = 0;
  for (let i = 1; i < coords.length; i++) distance += distanceOf(coords[i - 1], coords[i]);
  return distance;
}

/**
 * 幅員を補ったグラフを 1 枚作る。パスごとに呼び直す（applyGsiWidths と removeNarrowEdges がグラフを書き換えるため）。
 */
function buildSearchGraph(osmData: App.OSMData, profile: ModeProfile, gsiSegments: GsiRoadSegment[]) {
  const osmGraph = transformOSMMapToOSMGraph(osmData);
  const widthApplied = applyGsiWidths(osmGraph, new GsiRoadIndex(gsiSegments));
  const narrowRemoved =
    profile.minRoadWidth === undefined ? 0 : removeNarrowEdges(osmGraph, profile.minRoadWidth);

  const crossGraph = CrossConvert(osmGraph);
  if (crossGraph instanceof Error) throw crossGraph;
  const graph = fold2DegreeEdges(crossGraph);
  if (graph instanceof Error) throw graph;
  return { graph, widthApplied, narrowRemoved };
}

/**
 * 1 モードを探索する。本番（pathFind.ts の doPathFind）と同じく、
 * 始点・終点と経路の周りのタイルを順に足しながら探索し直す。
 */
async function searchMode(
  mode: ModeId,
  begin: App.Coordinate,
  end: App.Coordinate,
  useGsi: boolean,
): Promise<SearchResult> {
  const profile = MODE_PROFILES[mode];
  const osmData = trimOSMDataByMode(clone(loadFixture()), profile);

  const tiles = new Map<string, GsiTile>();
  const addTiles = (list: GsiTile[]) => list.forEach((tile) => tiles.set(tileKey(tile), tile));
  if (useGsi) {
    addTiles(tilesAlongPath([begin]));
    addTiles(tilesAlongPath([end]));
  }

  let last: SearchResult = {
    mode,
    found: false,
    reason: "NO_ROUTE",
    message: "経路が見つかりませんでした。",
    wayIds: [],
    distance: 0,
    intersections: 0,
  };

  for (let pass = 1; ; pass++) {
    const gsiSegments = useGsi
      ? await requireGsiRoadSegmentsForTiles([...tiles.values()], gsiCacheManager, fetchGsiRoadTile)
      : [];

    const { graph, widthApplied, narrowRemoved } = buildSearchGraph(osmData, profile, gsiSegments);
    const mainEdges = largestComponentEdges(graph);
    const beginNode = transientSplit(graph, begin, mainEdges);
    const endNode = transientSplit(graph, end, mainEdges);
    // pathFind は FoldedEdge を ComputedEdge に差し替えるので type で見分ける前に控えておく
    const wayIds = new Set(
      Object.values(graph.edges)
        .filter((edge) => edge.type === "FoldedEdge")
        .map((edge) => edge.id),
    );
    const snapDistance = {
      begin: distanceOf(begin, graph.nodes[beginNode].coordinate),
      end: distanceOf(end, graph.nodes[endNode].coordinate),
    };
    const base: Omit<SearchResult, "found" | "reason" | "message"> = {
      mode,
      wayIds: [],
      distance: 0,
      intersections: 0,
      snapDistance,
      widthApplied,
      narrowRemoved,
      graphNodes: Object.keys(graph.nodes).length,
      graphEdges: Object.keys(graph.edges).length,
      gsiPasses: pass,
      gsiTiles: tiles.size,
    };

    if (snapDistance.begin > MAX_SNAP_DISTANCE_M || snapDistance.end > MAX_SNAP_DISTANCE_M) {
      last = { ...base, found: false, reason: "SNAP_TOO_FAR", message: "始点・終点の近くに道が見つかりません" };
      break;
    }

    const pathEdges = pathFind(graph, profile.defaultParameters, [beginNode], [endNode], {
      ignoreOneway: profile.ignoreOneway,
      highwayCostFactor: profile.highwayCostFactor,
      scoring: profile.scoring,
    });
    if (pathEdges.length === 0) {
      last = { ...base, found: false, reason: "NO_ROUTE", message: "経路が見つかりませんでした。" };
      break;
    }

    const coords = pathToCoordinates(graph, pathEdges, beginNode);
    const pathSegments = pathEdges.flatMap((id) => {
      const edge = graph.edges[id];
      return edge && "segments" in edge ? edge.segments : [];
    });
    last = {
      ...base,
      found: true,
      wayIds: pathEdges.filter((id) => wayIds.has(id)),
      distance: totalDistance(coords),
      intersections: countPassedIntersections(graph, pathToNodeIds(graph, pathEdges, beginNode)),
      widthCoverage: measureSegmentsWidthCoverage(pathSegments),
    };

    // 経路の周りのタイルを足して、足りなければもう一度探索する（本番と同じ上限）
    if (!useGsi) break;
    const newTiles = tilesAlongPath(coords).filter((tile) => !tiles.has(tileKey(tile)));
    if (newTiles.length === 0 || pass >= MAX_GSI_PASSES) break;
    addTiles(newTiles);
  }

  return last;
}

/** 2 つの経路の一致率。短い方の経路が何割共通しているかを 0〜1 で返す */
function agreement(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  const shared = b.filter((id) => set.has(id)).length;
  return shared / Math.min(a.length, b.length);
}

const ratio = (value: number) => (Number.isNaN(value) ? "-" : `${(value * 100).toFixed(1)}%`);
const meters = (value: number) => `${Math.round(value)}m`;

function printTable(results: SearchResult[], options: Options) {
  console.log(
    `  ${"mode".padEnd(22)}${"distance".padStart(10)}${"ways".padStart(8)}` +
      `${"crossings".padStart(11)}${"width".padStart(9)}${"agreement".padStart(11)}${"passes".padStart(8)}`,
  );
  for (const result of results) {
    const label = `${result.mode} (${MODE_PROFILES[result.mode].name})`;
    if (!result.found) {
      console.log(
        `  ${label.padEnd(22)}${"-".padStart(10)}${"-".padStart(8)}${"-".padStart(11)}` +
          `${"-".padStart(9)}${"-".padStart(11)}${"-".padStart(8)}   ${result.reason}: ${result.message}`,
      );
      continue;
    }
    const reference = results.find((r) => r.mode === options.reference);
    const agree =
      result.mode === options.reference || reference === undefined || !reference.found
        ? NaN
        : agreement(result.wayIds, reference.wayIds);
    console.log(
      `  ${label.padEnd(22)}${meters(result.distance).padStart(10)}${String(result.wayIds.length).padStart(8)}` +
        `${String(result.intersections).padStart(11)}` +
        `${(result.widthCoverage?.ratio === null || result.widthCoverage === undefined
          ? "-"
          : ratio(result.widthCoverage.ratio)).padStart(9)}` +
        `${ratio(agree).padStart(11)}${String(result.gsiPasses).padStart(8)}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // gsiCacheManager は OSM_CACHE_DIR の下で gsi/ を使う。先に差し替えておく
  mkdirSync(options.gsiCacheDir, { recursive: true });
  process.env.OSM_CACHE_DIR = options.gsiCacheDir;

  const boundary = fixtureBoundary();
  const inside = (c: App.Coordinate) =>
    c.lat >= boundary.minLat && c.lat <= boundary.maxLat && c.lng >= boundary.minLng && c.lng <= boundary.maxLng;
  for (const [label, c] of [["始点", options.begin], ["終点", options.end]] as const) {
    if (!inside(c)) {
      throw new Error(
        `${label} ${c.lat},${c.lng} はフィクスチャの範囲 (${boundary.minLat}-${boundary.maxLat}, ` +
          `${boundary.minLng}-${boundary.maxLng}) の外です`,
      );
    }
  }

  console.log(`begin: ${options.begin.lat},${options.begin.lng}  end: ${options.end.lat},${options.end.lng}`);
  console.log(`mode: ${options.modes.join(", ")}  (一致率の基準: ${options.reference})`);
  console.log(`幅員: ${options.gsi ? "国土地理院のデータを使う" : "使わない"}`);

  const results: SearchResult[] = [];
  for (const mode of options.modes) {
    results.push(await searchMode(mode, options.begin, options.end, options.gsi));
  }

  printTable(results, options);

  if (options.json !== undefined) {
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify({ begin: options.begin, end: options.end, results }, null, 2)}\n`, "utf-8");
    console.log(`\nwrote ${options.json}`);
  }
}

main().catch((error) => {
  console.error(`compare-modes failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
