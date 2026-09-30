import { describe, expect, test } from "vitest";
import { distanceOf } from "../../src/lib/utils/haversine";

describe("distanceOf", () => {
  test("緯度 1° は約 111km", () => {
    // 地球の半径 6378137m で計算すると 2π・R / 360 ≒ 111,319m
    expect(distanceOf({ lat: 37, lng: 138 }, { lat: 38, lng: 138 })).toBeCloseTo(111319, -1);
  });

  test("経度方向の距離は緯度に応じて短くなる (cos(緯度) 倍)", () => {
    const d = distanceOf({ lat: 37.45, lng: 138.85 }, { lat: 37.45, lng: 138.86 });
    const expected = 111319 * 0.01 * Math.cos((37.45 * Math.PI) / 180);
    expect(d).toBeGreaterThan(expected * 0.999);
    expect(d).toBeLessThan(expected * 1.001);
  });

  test("長岡駅 → 見附駅 は約 11km", () => {
    const d = distanceOf(
      { lat: 37.448016415119234, lng: 138.85330120630306 },
      { lat: 37.540197914926495, lng: 138.90822230920017 },
    );
    expect(d).toBeGreaterThan(11000);
    expect(d).toBeLessThan(11600);
  });

  test("始点と終点を入れ替えても同じ距離", () => {
    const a = { lat: 37.44, lng: 138.85 }, b = { lat: 37.46, lng: 138.88 };
    expect(distanceOf(a, b)).toBeCloseTo(distanceOf(b, a), 6);
  });
});
