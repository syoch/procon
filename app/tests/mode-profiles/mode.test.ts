import { describe, expect, test } from "vitest";
import { isAccessible, MODE_PROFILES, parseDimension, resolveModeOneway } from "../../src/lib/mode_profiles";
import { trimOSMDataByMode } from "../../src/routes/api/osm/osm-data";
import { pathFind } from "../../src/lib/path_finder";

const { walk, bicycle, car, motorcycle, truck } = MODE_PROFILES;

describe("parseDimension", () => {
  test("数値と単位付きの値を読める", () => {
    expect(parseDimension("4.5")).toBe(4.5);
    expect(parseDimension("4.5m")).toBe(4.5);
    expect(parseDimension("8 t")).toBe(8);
  });
  test("数値でない値は制限なし (undefined) とみなす", () => {
    expect(parseDimension("default")).toBeUndefined();
    expect(parseDimension(undefined)).toBeUndefined();
  });
});

describe("isAccessible: 徒歩", () => {
  test("高速道路・自動車専用道路・foot=no は通れない", () => {
    expect(isAccessible(walk, { highway: "motorway" })).toBe(false);
    expect(isAccessible(walk, { highway: "motorway_link" })).toBe(false);
    expect(isAccessible(walk, { highway: "trunk", motorroad: "yes" })).toBe(false);
    expect(isAccessible(walk, { highway: "trunk", foot: "no" })).toBe(false);
  });
  test("一般道・歩道・階段は通れる", () => {
    expect(isAccessible(walk, { highway: "trunk" })).toBe(true);
    expect(isAccessible(walk, { highway: "footway" })).toBe(true);
    expect(isAccessible(walk, { highway: "steps" })).toBe(true);
  });
  test("cycleway は foot=designated のときだけ通れる", () => {
    expect(isAccessible(walk, { highway: "cycleway" })).toBe(false);
    expect(isAccessible(walk, { highway: "cycleway", foot: "designated" })).toBe(true);
  });
  test("具体的なキーが一般的なキーより優先される", () => {
    expect(isAccessible(walk, { highway: "service", access: "no", foot: "yes" })).toBe(true);
    expect(isAccessible(walk, { highway: "service", access: "private" })).toBe(false);
  });
});

describe("isAccessible: 自転車", () => {
  test("高速道路・階段・bicycle=no は通れない", () => {
    expect(isAccessible(bicycle, { highway: "motorway" })).toBe(false);
    expect(isAccessible(bicycle, { highway: "steps" })).toBe(false);
    expect(isAccessible(bicycle, { highway: "primary", bicycle: "no" })).toBe(false);
  });
  test("footway は bicycle=yes (自転車歩道通行可) のときだけ通れる", () => {
    expect(isAccessible(bicycle, { highway: "footway" })).toBe(false);
    expect(isAccessible(bicycle, { highway: "footway", bicycle: "yes" })).toBe(true);
  });
});

describe("isAccessible: 車・バイク", () => {
  test("歩道・motor_vehicle=no は通れない", () => {
    expect(isAccessible(car, { highway: "footway" })).toBe(false);
    expect(isAccessible(car, { highway: "residential", motor_vehicle: "no" })).toBe(false);
  });
  test("高速道路とランプは通れる", () => {
    expect(isAccessible(car, { highway: "motorway" })).toBe(true);
    expect(isAccessible(car, { highway: "motorway_link" })).toBe(true);
    expect(isAccessible(motorcycle, { highway: "motorway" })).toBe(true);
  });
  test("バイクは motorcycle=no を通れないが、車は通れる", () => {
    expect(isAccessible(motorcycle, { highway: "primary", motorcycle: "no" })).toBe(false);
    expect(isAccessible(car, { highway: "primary", motorcycle: "no" })).toBe(true);
  });
});

describe("isAccessible: 大型トラック", () => {
  test("hgv=no は通れないが、車は通れる", () => {
    expect(isAccessible(truck, { highway: "secondary", hgv: "no" })).toBe(false);
    expect(isAccessible(car, { highway: "secondary", hgv: "no" })).toBe(true);
  });
  test("寸法制限 (幅・高さ・重量) を下回る道は通れない", () => {
    expect(isAccessible(truck, { highway: "tertiary", maxwidth: "2.2" })).toBe(false);
    expect(isAccessible(truck, { highway: "tertiary", maxheight: "3.3" })).toBe(false);
    expect(isAccessible(truck, { highway: "tertiary", maxweight: "8.0" })).toBe(false);
  });
  test("寸法制限に余裕があれば通れる (単位付き・数値でない値も扱える)", () => {
    expect(isAccessible(truck, { highway: "tertiary", maxwidth: "4.5m" })).toBe(true);
    expect(isAccessible(truck, { highway: "tertiary", maxheight: "default" })).toBe(true);
  });
  test("living_street は通れない", () => {
    expect(isAccessible(truck, { highway: "living_street" })).toBe(false);
  });
});

describe("trimOSMDataByMode", () => {
  test("通行できる way とそのノードだけが残る", () => {
    const data: App.OSMData = {
      elements: [
        { type: "way", id: 1, nodes: [10, 11], tags: { highway: "motorway" } },
        { type: "way", id: 2, nodes: [11, 12], tags: { highway: "footway" } },
        { type: "node", id: 10, lat: 0, lon: 0 },
        { type: "node", id: 11, lat: 0, lon: 0.001 },
        { type: "node", id: 12, lat: 0, lon: 0.002 },
      ],
    };
    const walkData = trimOSMDataByMode(data, walk);
    expect(walkData.elements.filter((e) => e.type === "way").map((e) => e.id)).toEqual([2]);
    expect(walkData.elements.filter((e) => e.type === "node").map((e) => e.id).sort()).toEqual([11, 12]);

    const carData = trimOSMDataByMode(data, car);
    expect(carData.elements.filter((e) => e.type === "way").map((e) => e.id)).toEqual([1]);
  });
});

describe("pathFind: ignoreOneway", () => {
  // A → B の一方通行だけがあるグラフで、B から A へ向かう
  function onewayGraph(): App.SearchGraph {
    const seg: App.Segment = {
      begin_coordinate: { lat: 0, lng: 0 },
      end_coordinate: { lat: 0, lng: 0.001 },
      highway: "residential",
      width: 3,
      sidewalk: "both",
      tags: {}
    };
    return {
      nodes: {
        A: { type: "SplittedNode", id: "A", coordinate: { lat: 0, lng: 0 }, edges: ["AB"] },
        B: { type: "SplittedNode", id: "B", coordinate: { lat: 0, lng: 0.001 }, edges: ["AB"] },
      },
      edges: {
        AB: { type: "FoldedEdge", id: "AB", begin: "A", end: "B", direction: "forward", segments: [seg] },
      },
    };
  }
  const params = walk.defaultParameters;

  test("既定では一方通行を逆走しない", () => {
    expect(pathFind(onewayGraph(), params, ["B"], ["A"])).toEqual([]);
  });
  test("ignoreOneway を指定すると逆向きにも通れる (徒歩)", () => {
    expect(pathFind(onewayGraph(), params, ["B"], ["A"], { ignoreOneway: true })).toEqual(["AB"]);
  });
});

describe("resolveModeOneway", () => {
  test("自転車は oneway:bicycle があればそれを使い、無ければ oneway に従う", () => {
    expect(resolveModeOneway(bicycle, { oneway: "yes", "oneway:bicycle": "no" })).toBe("no");
    expect(resolveModeOneway(bicycle, { oneway: "yes" })).toBeUndefined();
  });
  test("車は oneway:bicycle を見ない", () => {
    expect(resolveModeOneway(car, { oneway: "yes", "oneway:bicycle": "no" })).toBeUndefined();
  });
});

describe("trimOSMDataByMode: モード専用の一方通行タグ", () => {
  test("自転車では oneway が oneway:bicycle の値に置き換わり、元のデータは書き換えない", () => {
    const way: App.OSMRawWay = { type: "way", id: 1, nodes: [10, 11], tags: { highway: "residential", oneway: "yes", "oneway:bicycle": "no" } };
    const data: App.OSMData = { elements: [way, { type: "node", id: 10, lat: 0, lon: 0 }, { type: "node", id: 11, lat: 0, lon: 0.001 }] };
    const trimmed = trimOSMDataByMode(data, bicycle).elements.find((e) => e.type === "way") as App.OSMRawWay;
    expect(trimmed.tags.oneway).toBe("no");
    expect(way.tags.oneway).toBe("yes");
    const forCar = trimOSMDataByMode(data, car).elements.find((e) => e.type === "way") as App.OSMRawWay;
    expect(forCar.tags.oneway).toBe("yes");
  });
});

describe("isAccessible: track / service の扱い", () => {
  test("車・バイクは舗装された track だけ通れる", () => {
    for (const mode of [car, motorcycle]) {
      expect(isAccessible(mode, { highway: "track", tracktype: "grade1" })).toBe(true);
      expect(isAccessible(mode, { highway: "track", surface: "asphalt" })).toBe(true);
      expect(isAccessible(mode, { highway: "track" })).toBe(false);
      expect(isAccessible(mode, { highway: "track", tracktype: "grade3" })).toBe(false);
    }
  });
  test("車・バイク・トラックは service を通れる", () => {
    for (const mode of [car, motorcycle, truck]) {
      expect(isAccessible(mode, { highway: "service" })).toBe(true);
    }
  });
  test("大型トラックは舗装されていても track を通れない", () => {
    expect(isAccessible(truck, { highway: "track", tracktype: "grade1" })).toBe(false);
  });
  test("舗装された track でも規制タグがあれば通れない", () => {
    expect(isAccessible(car, { highway: "track", tracktype: "grade1", motor_vehicle: "no" })).toBe(false);
  });
});

