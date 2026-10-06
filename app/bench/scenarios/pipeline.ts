import { CrossConvert } from "../../src/lib/cross_transform";
import { fold2DegreeEdges } from "../../src/lib/fold2degree";
import { largestComponentEdges } from "../../src/lib/utils/graph";
import { transformOSMMapToOSMGraph } from "../../src/lib/map_loader/osm";
import { transientSplit } from "../../src/lib/transient-split";
import { pathFind } from "../../src/lib/path_finder";
import { collectRoadJunctions, detectSharpTurnsOnPath } from "../../src/lib/sharp_turn";
import { measureSegmentsWidthCoverage } from "../../src/lib/road_width";
import { MODE_PROFILES, type ModeId } from "../../src/lib/mode_profiles";
import {
  SplitOSMData,
  mergeOSMData,
  trimOSMData,
  trimOSMDataByMode,
} from "../../src/routes/api/osm/osm-data";
import { divideBoundary, simplifyBoundaries } from "../../src/routes/api/osm/boundary";
import { clone, fixtureBoundary, loadFixture, pickEndpointsOnMainComponent } from "../lib/data";
import { StageRecorder } from "../lib/harness";
import type { Scenario } from "./types";

/**
 * 1 回の経路探索にかかる CPU を段ごとに測る。
 *
 * 本番の `RequestContext` は `requireOSMData` しか計測していないため、グラフ構築・
 * 経路探索・急カーブ判定は現状どのログにも現れない。このシナリオはその穴を埋める。
 *
 * GSI の幅員データ（`requireGsiRoadSegmentsForTiles`）はネットワーク依存なので含めない。
 * 本番では `MAX_GSI_PASSES` 回グラフを作り直すので、グラフ構築と探索の段は
 * 1 パスあたりの値であり、実際には最大その回数倍になる。
 */
/** 経路探索の特性はモードで変わるので、モードごとに 1 個作る */
export function pipelineScenario(mode: ModeId): Scenario {
  return {
    name: "pipeline",
    description: "1 回の経路探索（キャッシュ済み）にかかる CPU を段ごとに測る",
    mode,
    run({ iterations, warmup }) {
      const profile = MODE_PROFILES[mode];
      const parameters = profile.defaultParameters;
      const fixture = loadFixture();
      const boundary = fixtureBoundary();
      const cellCount = divideBoundary(boundary).length;

      // 始点・終点は最大連結成分上の実ノードから選ぶ。
      // bbox の補間点だと道から離れ、transientSplit が「エッジの長さがゼロです」で
      // 警告を出し、pathFind が空振りして時間を計測できなくなる。
      const probe = buildSearchGraph(trimOSMDataByMode(clone(fixture), profile));
      const { begin, end } = pickEndpointsOnMainComponent(mainComponentCoordinates(probe));

      const recorder = new StageRecorder({ warmup, iterations });
      let info: Record<string, string | number | boolean> = {};

      for (let i = 0; i < iterations + warmup; i++) {
        // clone は測定対象ではない。計測の開始位置だけ先へ進めてから測り始める
        const data = clone(fixture);
        recorder.reset();

        const divided = divideBoundary(boundary);
        recorder.mark("divideBoundary");

        const simplified = simplifyBoundaries(divided);
        recorder.mark("simplifyBoundaries");

        const split = SplitOSMData(data);
        recorder.mark("SplitOSMData");

        // requireOSMData の read 側と同じ構造: セルごとのデータを結合してから境界で trim する
        const merged: App.OSMData = { elements: [] };
        mergeOSMData(
          merged,
          ...Object.values(split).map((chunk) => chunk),
        );
        recorder.mark("mergeOSMData");

        trimOSMData(merged, boundary);
        recorder.mark("trimOSMData");

        const osmData = trimOSMDataByMode(data, profile);
        recorder.mark("trimOSMDataByMode");

        const osmGraph = transformOSMMapToOSMGraph(osmData);
        recorder.mark("transformOSMMapToOSMGraph");

        const crossGraph = CrossConvert(osmGraph);
        if (crossGraph instanceof Error) throw crossGraph;
        recorder.mark("CrossConvert");

        const searchGraph = fold2DegreeEdges(crossGraph);
        if (searchGraph instanceof Error) throw searchGraph;
        recorder.mark("fold2DegreeEdges");

        const mainEdges = largestComponentEdges(searchGraph);
        recorder.mark("largestComponentEdges");

        const beginNode = transientSplit(searchGraph, begin, mainEdges);
        const endNode = transientSplit(searchGraph, end, mainEdges);
        recorder.mark("transientSplit");

        const path = pathFind(searchGraph, parameters, [beginNode], [endNode], {
          ignoreOneway: profile.ignoreOneway,
          highwayCostFactor: profile.highwayCostFactor,
          scoring: profile.scoring,
          speed: profile.speed,
        });
        recorder.mark("pathFind");

        // 段はモードによらず常に測る。急カーブを検出しなくても段の測定値は意味を持つ
        const junctions = collectRoadJunctions(osmData);
        recorder.mark("collectRoadJunctions");

        const sharpTurnCount =
          profile.sharpTurnMinRadius === undefined || path.length === 0
            ? 0
            : detectSharpTurnsOnPath(searchGraph, path, beginNode, {
                minRadius: profile.sharpTurnMinRadius,
                junctions,
                bounds: boundary,
              }).length;
        recorder.mark("detectSharpTurnsOnPath");

        const segments = path.flatMap((edgeId) =>
          "segments" in searchGraph.edges[edgeId] ? searchGraph.edges[edgeId].segments : [],
        );
        measureSegmentsWidthCoverage(segments);
        recorder.mark("measureSegmentsWidthCoverage");

        if (i === warmup) {
          info = {
            mode,
            cellCount,
            simplifiedRegionCount: simplified.length,
            splitChunkCount: Object.keys(split).length,
            fixtureNodes: fixture.elements.filter((e) => e.type === "node").length,
            fixtureWays: fixture.elements.filter((e) => e.type === "way").length,
            searchGraphNodes: Object.keys(searchGraph.nodes).length,
            searchGraphEdges: Object.keys(searchGraph.edges).length,
            componentEdges: mainEdges.size,
            pathLength: path.length,
            sharpTurnCount,
          };
        }
      }

      const stages = recorder.result();
      return {
        scenario: "pipeline",
        mode,
        stages,
        total: Object.values(stages).reduce((sum, s) => sum + s.median, 0),
        info,
      };
    },
    };
}

function buildSearchGraph(osmData: App.OSMData): App.SearchGraph {
  const crossGraph = CrossConvert(transformOSMMapToOSMGraph(osmData));
  if (crossGraph instanceof Error) throw crossGraph;
  const searchGraph = fold2DegreeEdges(crossGraph);
  if (searchGraph instanceof Error) throw searchGraph;
  return searchGraph;
}

function mainComponentCoordinates(graph: App.SearchGraph): { coordinate: App.Coordinate }[] {
  const mainEdges = largestComponentEdges(graph);
  const seen = new Set<App.NodeId>();
  const coordinates: { coordinate: App.Coordinate }[] = [];
  for (const edgeId of mainEdges) {
    const edge = graph.edges[edgeId];
    for (const nodeId of [edge.begin, edge.end]) {
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      const node = graph.nodes[nodeId];
      if (node?.coordinate) coordinates.push({ coordinate: node.coordinate });
    }
  }
  return coordinates;
}
