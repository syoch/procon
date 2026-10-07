import { describe, expect, test } from "vitest";
import { scoreMix, SCORING_PROFILES } from "../../src/lib/mode_scoring";
import { CalculateCost } from "../../src/lib/cost_calculator";

const { walk, bicycle, car, truck } = SCORING_PROFILES;

describe("scoreMix: 幅員クラス × 歩道の有無", () => {
  test("幅の境目 (3.0m / 5.5m) で幅員クラスが変わる", () => {
    // 徒歩・歩道なし: 3m 未満 0.4 / 3〜5.5m 0.5 / 5.5m 以上 0.7
    expect(scoreMix(walk, undefined, "residential", 2)).toBe(0.4);
    expect(scoreMix(walk, undefined, "residential", 4)).toBe(0.5);
    expect(scoreMix(walk, undefined, "residential", 8)).toBe(0.7);
  });
  test("同じ幅員クラスでも歩道タグがあれば高い", () => {
    expect(scoreMix(walk, "both", "residential", 8)).toBe(0.8);
    expect(scoreMix(walk, "both", "residential", 8)!).toBeGreaterThan(scoreMix(walk, undefined, "residential", 8)!);
  });
  test("歩道なし: 徒歩は幅が狭いほど低い (車と空間を共有する)", () => {
    const narrow = scoreMix(walk, undefined, "residential", 2)!;
    const wide = scoreMix(walk, undefined, "residential", 8)!;
    expect(narrow).toBeLessThan(wide);
  });
  test("歩道なし: 自転車は幅が広いほど低い (車が速い)", () => {
    const narrow = scoreMix(bicycle, undefined, "residential", 2)!;
    const wide = scoreMix(bicycle, undefined, "residential", 8)!;
    expect(wide).toBeLessThan(narrow);
  });
  test("車・バイク・トラックにも幅員クラスの定義がある", () => {
    expect(scoreMix(car, undefined, "residential", 8)).toBe(0.8);
    expect(scoreMix(truck, undefined, "residential", 8)).toBe(0.8);
  });
  test("幅が分からない道は highway 種別にフォールバックする", () => {
    expect(scoreMix(walk, undefined, "footway", undefined)).toBe(1.0);
    expect(scoreMix(walk, undefined, "footway", -1)).toBe(1.0);
    expect(scoreMix(bicycle, undefined, "cycleway", 0)).toBe(1.0);
  });
  test("幅が分からず歩道タグがある道と、定義の無いモードは従来の計算に任せる", () => {
    expect(scoreMix(walk, "both", "residential")).toBeUndefined();
    expect(scoreMix(undefined, undefined, "residential", 8)).toBeUndefined();
  });
});

/** 直線上の幅の一覧を持つ 1 本の FoldedEdge */
function folded(highway: string, widths: (number | null)[], sidewalk: string | null): App.FoldedEdge {
  const step = 0.0001;
  return {
    type: "FoldedEdge", id: "e", begin: "e-b", end: "e-e", direction: "both",
    segments: widths.map((width, i) => ({
      begin_coordinate: { lat: step * i, lng: 0 },
      end_coordinate: { lat: step * (i + 1), lng: 0 },
      highway,
      width,
      sidewalk,
    })),
  };
}

describe("CalculateCost: 平均幅員を混在スコアに使う", () => {
  test("区間の平均幅で幅員クラスを決める", () => {
    // 平均 5m (2m と 8m) → 3〜5.5m のクラス。車・歩道なしは 0.5
    const cost = CalculateCost(folded("residential", [2, 8], null), car);
    if (cost instanceof Error) throw new Error("unexpected");
    expect(cost.mix_score).toBe(0.5);
  });
  test("モードを渡さない場合は従来の計算のまま (幅員を使わない)", () => {
    const cost = CalculateCost(folded("residential", [8], null));
    if (cost instanceof Error) throw new Error("unexpected");
    expect(cost.mix_score).toBe(0.3);
  });
});
