import { describe, expect, test } from "vitest";
import { scoreMix, scoreWidth, SCORING_PROFILES } from "../../src/lib/mode_scoring";
import { MODE_PROFILES } from "../../src/lib/mode_profiles";
import { CalculateCost } from "../../src/lib/cost_calculator";
import { pathFind } from "../../src/lib/path_finder";

const { walk, bicycle, car, truck } = SCORING_PROFILES;

describe("scoreWidth", () => {
  test("車は国土地理院の区分の境目 (3m / 5.5m / 13m) で段階的に上がる", () => {
    expect(scoreWidth(car, 2)).toBe(0.1);
    expect(scoreWidth(car, 4)).toBe(0.4);
    expect(scoreWidth(car, 8)).toBe(0.8);
    expect(scoreWidth(car, 15)).toBe(1.0);
  });
  test("大型トラックは車より厳しい", () => {
    expect(scoreWidth(truck, 4)!).toBeLessThan(scoreWidth(car, 4)!);
    expect(scoreWidth(truck, 8)!).toBeLessThan(scoreWidth(car, 8)!);
  });
  test("段の並び順に依存しない (昇順で定義しても同じ結果)", () => {
    const ascending = { widthScoreSteps: [...car.widthScoreSteps!].reverse() };
    for (const width of [2, 4, 8, 15]) {
      expect(scoreWidth(ascending, width)).toBe(scoreWidth(car, width));
    }
  });
  test("幅が分からない場合と、定義が無いモードは従来の計算に任せる (undefined)", () => {
    expect(scoreWidth(car, undefined)).toBeUndefined();
    expect(scoreWidth(car, -1)).toBeUndefined();
    expect(scoreWidth(walk, 8)).toBeUndefined();
  });
});

describe("scoreMix", () => {
  test("徒歩は歩行者専用の道が最も高く、幹線 (歩道があることが多い) は住宅地の道より高い", () => {
    expect(scoreMix(walk, undefined, "footway")).toBe(1.0);
    expect(scoreMix(walk, undefined, "primary")!).toBeGreaterThan(scoreMix(walk, undefined, "residential")!);
  });
  test("自転車は自転車道が最も高く、幹線 (車が速い) は住宅地の道より低い", () => {
    expect(scoreMix(bicycle, undefined, "cycleway")).toBe(1.0);
    expect(scoreMix(bicycle, undefined, "primary")!).toBeLessThan(scoreMix(bicycle, undefined, "residential")!);
  });
  test("載っていない種別は既定値", () => {
    expect(scoreMix(walk, undefined, "raceway")).toBe(walk.mixScoreDefault);
  });
  test("歩道タグがある道と、定義が無いモード (車系) は従来の計算に任せる (undefined)", () => {
    expect(scoreMix(walk, "both", "residential")).toBeUndefined();
    expect(scoreMix(car, undefined, "residential")).toBeUndefined();
  });
});

describe("MODE_PROFILES のスコア", () => {
  test("徒歩と自転車は同じ重みで、違いはスコアの中身で出す", () => {
    expect(MODE_PROFILES.walk.defaultParameters).toEqual(MODE_PROFILES.bicycle.defaultParameters);
    expect(MODE_PROFILES.walk.scoring).not.toBe(MODE_PROFILES.bicycle.scoring);
  });
});

/** 1 区間だけの FoldedEdge */
function folded(id: string, begin: App.Coordinate, end: App.Coordinate, highway: string, width: number | null): App.FoldedEdge {
  return {
    type: "FoldedEdge", id, begin: `${id}-b`, end: `${id}-e`, direction: "both",
    segments: [{ begin_coordinate: begin, end_coordinate: end, highway, width, sidewalk: null, tags: {} }],
  };
}

describe("CalculateCost", () => {
  test("モードの定義を渡すと、幅が分かる道は実際の幅でスコアを付ける", () => {
    const edge = folded("e", { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, "residential", 8);
    const common = CalculateCost(edge);
    const forCar = CalculateCost(edge, car);
    if (common instanceof Error || forCar instanceof Error) throw new Error("unexpected");
    expect(common.width_score).toBe(1.0);
    expect(forCar.width_score).toBe(0.8);
  });
  test("定義を渡さない場合 (mode なしの API) は従来どおり", () => {
    const edge = folded("e", { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, "footway", null);
    const common = CalculateCost(edge);
    if (common instanceof Error) throw new Error("unexpected");
    expect(common.mix_score).toBe(0.1);
  });
});

describe("pathFind: モードごとのスコアで経路が変わる", () => {
  // A → B に、住宅地の道 (直進) と、約 1.1 倍の長さの歩行者用の道 (C 経由) がある
  const A = { lat: 0, lng: 0 }, B = { lat: 0, lng: 0.001 }, C = { lat: 0.00023, lng: 0.0005 };
  function graph(): App.SearchGraph {
    const node = (id: string, coordinate: App.Coordinate, edges: string[]): App.SplittedNode => ({ type: "SplittedNode", id, coordinate, edges });
    const edge = (id: string, begin: string, end: string, from: App.Coordinate, to: App.Coordinate, highway: string) =>
      ({ ...folded(id, from, to, highway, null), begin, end });
    return {
      nodes: { A: node("A", A, ["AB", "AC"]), B: node("B", B, ["AB", "CB"]), C: node("C", C, ["AC", "CB"]) },
      edges: {
        AB: edge("AB", "A", "B", A, B, "residential"),
        AC: edge("AC", "A", "C", A, C, "footway"),
        CB: edge("CB", "C", "B", C, B, "footway"),
      },
    };
  }

  test("徒歩は少し遠くても歩行者用の道を選ぶ", () => {
    const path = pathFind(graph(), MODE_PROFILES.walk.defaultParameters, ["A"], ["B"], { scoring: walk });
    expect(path).toEqual(["AC", "CB"]);
  });
  test("自転車は同じ重みでも住宅地の道を選ぶ (歩行者用の道の評価が徒歩より低い)", () => {
    const path = pathFind(graph(), MODE_PROFILES.bicycle.defaultParameters, ["A"], ["B"], { scoring: bicycle });
    expect(path).toEqual(["AB"]);
  });
});
