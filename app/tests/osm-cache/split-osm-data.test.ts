import { expect, test } from "vitest";
import { SplitOSMData, trimOSMData } from "../../src/lib/osm/osm-data";
import { divideBoundary, type Boundary } from "../../src/lib/osm/boundary";
import { deltaLatitude, deltaLongitude } from "../../src/lib/osm/grid";

const D_LAT = deltaLatitude;
const D_LNG = deltaLongitude;

/**
 * SplitOSMData の返り値キー。セル左下隅の座標 (`minLat,minLng`) の組で、
 * divideBoundary が作るセルの minLat/minLng とそのまま一致する。
 * index.ts は `${b.minLat},${b.minLng}` で参照する。
 */
const keyOf = (latIndex: number, lngIndex: number) => `${latIndex * D_LAT},${lngIndex * D_LNG}`;

/** セル (latIndex, lngIndex) の境界。divideBoundary が返すセルと同じ形 */
function cellOf(latIndex: number, lngIndex: number): Boundary {
  return {
    minLat: latIndex * D_LAT,
    maxLat: (latIndex + 1) * D_LAT,
    minLng: lngIndex * D_LNG,
    maxLng: (lngIndex + 1) * D_LNG,
  };
}

/** セル (latIndex, lngIndex) の中心。グリッド境界上に乗らないことが保証される */
function centerOf(latIndex: number, lngIndex: number) {
  return { lat: (latIndex + 0.5) * D_LAT, lon: (lngIndex + 0.5) * D_LNG };
}

function idsOf(data: App.OSMData) {
  return {
    ways: data.elements.filter((e) => e.type === "way").map((e) => e.id).sort((a, b) => a - b),
    nodes: data.elements.filter((e) => e.type === "node").map((e) => e.id).sort((a, b) => a - b),
  };
}

type Split = Record<string, App.OSMData>;

const get = (result: Split, latIndex: number, lngIndex: number): App.OSMData =>
  result[keyOf(latIndex, lngIndex)];

test("SplitOSMData はノードが無ければ空オブジェクトを返す", () => {
  expect(SplitOSMData({ elements: [] })).toEqual({});
  expect(SplitOSMData({ elements: [{ type: "way", id: 1, nodes: [], tags: {} }] })).toEqual({});
  // way のノードが全て応答の外にある場合もチャンクは作られない
  expect(SplitOSMData({ elements: [{ type: "way", id: 1, nodes: [999], tags: {} }] })).toEqual({});
});

test("SplitOSMData のキーはセル左下隅の座標で divideBoundary と一致する", () => {
  const result = SplitOSMData({ elements: [{ type: "node", id: 1, ...centerOf(2, 3) }] });
  expect(Object.keys(result)).toEqual([keyOf(2, 3)]);
  // index.ts は `${b.minLat},${b.minLng}` で引くので、この形式が必須
  expect(Object.keys(result)).toContain(`${2 * D_LAT},${3 * D_LNG}`);
  // グリッド番号ではない
  expect(Object.keys(result)).not.toContain("2,3");
});

test("SplitOSMData はノードをセルごとに分ける", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(3, 4) },
      { type: "node", id: 3, ...centerOf(0, 0) },
      { type: "way", id: 10, nodes: [1, 3], tags: {} },
      { type: "way", id: 20, nodes: [2], tags: {} },
    ],
  });

  expect(Object.keys(result).sort()).toEqual([keyOf(0, 0), keyOf(3, 4)].sort());
  expect(idsOf(get(result, 0, 0)).nodes).toEqual([1, 3]);
  expect(idsOf(get(result, 3, 4)).nodes).toEqual([2]);
});

/**
 * 現在の挙動: way から参照されないノード (孤立ノード) はチャンクの要素に入らない。
 * チャンク自体は作られる (キーは存在する) が要素は空。
 * trimOSMData は境界内の孤立ノードをすべて残すので、実データでは trim と一致しない。
 */
test("SplitOSMData: 孤立ノード (way から参照されない node) は要素に入らない", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 0) },
      { type: "way", id: 10, nodes: [1], tags: {} },
    ],
  });

  expect(idsOf(get(result, 0, 0)).ways).toEqual([10]);
  expect(idsOf(get(result, 0, 0)).nodes).toEqual([1]);

  // 対照: trimOSMData は孤立ノードも残す
  const data: App.OSMData = {
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 0) },
      { type: "way", id: 10, nodes: [1], tags: {} },
    ],
  };
  expect(idsOf(trimOSMData(data, cellOf(0, 0))).nodes).toEqual([1, 2]);
});

test("SplitOSMData のキーは divideBoundary のセルと対応する", () => {
  const region: Boundary = {
    minLat: 2 * D_LAT, maxLat: 6 * D_LAT,
    minLng: 1 * D_LNG, maxLng: 4 * D_LNG,
  };
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(2, 3) },
      { type: "node", id: 2, ...centerOf(5, 1) },
    ],
  });

  // divideBoundary が作るセルの minLat/minLng がそのままキーになる
  const dividedKeys = new Set(divideBoundary(region).map((b) => `${b.minLat},${b.minLng}`));
  for (const k of Object.keys(result)) expect(dividedKeys.has(k)).toBe(true);
});

test("SplitOSMData: way はノードが1つでもセル内にあれば含まれ、参照ノードも入る", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 5) },
      { type: "way", id: 100, nodes: [1, 2], tags: { highway: "residential" } },
    ],
  });

  // way は (0,0) のノードに接するので両方のセルに入る
  for (const [a, b] of [[0, 0], [0, 5]] as [number, number][]) {
    const c = get(result, a, b);
    expect(idsOf(c).ways).toEqual([100]);
    // way が参照するノードは自分のセル外でも入る
    expect(idsOf(c).nodes).toEqual([1, 2]);
  }
});

test("SplitOSMData: 全ノードがセル外の way は含まれない", () => {
  // (0,0) のチャンクは存在させる (way 200 のノードは別の 2 セルにある)
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(9, 9) },
      { type: "node", id: 3, ...centerOf(8, 8) },
      { type: "way", id: 200, nodes: [2, 3], tags: {} },
    ],
  });

  expect(idsOf(get(result, 0, 0)).ways).toEqual([]);
  expect(idsOf(get(result, 9, 9)).ways).toEqual([200]);
  expect(idsOf(get(result, 8, 8)).ways).toEqual([200]);
});

test("SplitOSMData: セルをまたぐ way は各チャンクに含まれる", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(3, 3) },
      { type: "way", id: 300, nodes: [1, 2], tags: {} },
    ],
  });

  expect(idsOf(get(result, 0, 0)).ways).toEqual([300]);
  expect(idsOf(get(result, 3, 3)).ways).toEqual([300]);
});

test("SplitOSMData: 未知の type は無視される", () => {
  const elements = [
    { type: "node", id: 1, ...centerOf(0, 0) },
    { type: "way", id: 2, nodes: [1], tags: {} },
    { type: "relation", id: 3, members: [] },
  ] as unknown as App.OSMData["elements"];

  for (const c of Object.values(SplitOSMData({ elements }) as Split)) {
    expect(c.elements.map((e) => (e as { type: string }).type)).not.toContain("relation");
  }
});

test("SplitOSMData: 負座標でも正しいセルに入る", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, lat: -0.5 * D_LAT, lon: -0.5 * D_LNG },
      { type: "node", id: 2, lat: -3.5 * D_LAT, lon: -1.5 * D_LNG },
      { type: "way", id: 10, nodes: [1], tags: {} },
      { type: "way", id: 20, nodes: [2], tags: {} },
    ],
  });

  // Math.floor は負で -1 側に倒すので、-0.5 セルはインデックス -1
  expect(idsOf(get(result, -1, -1)).nodes).toEqual([1]);
  expect(idsOf(get(result, -4, -2)).nodes).toEqual([2]);
});

test("SplitOSMData: trimOSMData をセルごとに適用した結果と一致する", () => {
  // セル境界上にノードが乗らないよう、すべて中心座標を使う
  const cells: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 3]];
  const nodes: App.OSMRawNode[] = cells.map(([a, b], i) => ({ type: "node", id: i + 1, ...centerOf(a, b) }));
  const way = (id: number, ns: number[], tags: Record<string, string> = {}): App.OSMRawWay => ({ type: "way", id, nodes: ns, tags });
  const ways: App.OSMRawWay[] = [way(100, [1, 7], { highway: "primary" }), way(101, [1, 2], { highway: "residential" }), way(102, [3, 4]), way(103, [5, 6])];
  const data: App.OSMData = { elements: [...nodes, ...ways] };

  const result = SplitOSMData(data);
  for (const [a, b] of cells) {
    const actual = get(result, a, b);
    expect(actual, `セル (${a},${b}) のチャンクが見つからない`).toBeDefined();
    expect(idsOf(actual), `セル (${a},${b}) が trim と一致しない`).toEqual(idsOf(trimOSMData(data, cellOf(a, b))));
  }
});

test("SplitOSMData: チャンク間で way が失われない", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(4, 4) },
      { type: "way", id: 100, nodes: [1, 2], tags: {} },
    ],
  });

  const wayIds = new Set(Object.values(result as Split).flatMap((c) => idsOf(c).ways));
  expect(wayIds).toEqual(new Set([100]));
});

test("SplitOSMData: ノードのないセルはチャンクを生成しない", () => {
  // 16 セルのうちノードが入る 1 セルだけ
  const region: Boundary = { minLat: 0, maxLat: 4 * D_LAT, minLng: 0, maxLng: 4 * D_LNG };
  const cells = divideBoundary(region);
  const data: App.OSMData = { elements: [{ type: "node", id: 1, ...centerOf(0, 0) }] };
  const result = SplitOSMData(data);

  expect(cells.length).toBe(16);
  expect(Object.keys(result).length).toBe(1);

  // 保存側は boundariesToGet の全セルを保存するので、欠けたセルは呼び出し側が補う
  const covered = new Set(Object.keys(result));
  const missing = cells.filter((c) => !covered.has(`${c.minLat},${c.minLng}`));
  expect(missing.length).toBe(15);
  // 補う値は trim 相当の空データ
  expect(idsOf(trimOSMData(data, missing[0]))).toEqual({ ways: [], nodes: [] });
});

test("SplitOSMData: グリッド境界上のノードは上位セルにのみ属する (trimOSMData は両セルに含む)", () => {
  // trimOSMData は両端を含むので境界上のノードは隣接セル双方に入るが、
  // SplitOSMData は Math.floor で一意に振り分ける（重複しない）
  const data: App.OSMData = { elements: [{ type: "node", id: 1, lat: D_LAT, lon: D_LNG }] };
  const result = SplitOSMData(data);

  // 境界上のノードは (1,1) のチャンクだけを作る。(0,0) のチャンクは作られない
  expect(Object.keys(result)).toEqual([keyOf(1, 1)]);
  expect(get(result, 0, 0)).toBeUndefined();
  // このノードは孤立しているので要素は入らない (キーは存在する)
  expect(idsOf(get(result, 1, 1))).toEqual({ ways: [], nodes: [] });

  // 対照: trimOSMData は 2 セルともに入る
  expect(trimOSMData(data, cellOf(0, 0)).elements.length).toBe(1);
  expect(trimOSMData(data, cellOf(1, 1)).elements.length).toBe(1);
});

test("SplitOSMData: 境界上のノードを way が参照しても必要なチャンクには入る", () => {
  // 境界上のノードは「セルの元になるノード」としては数えられないが、
  // way が参照していれば登録を通じてチャンクに入る
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, lat: D_LAT, lon: D_LNG },
      { type: "way", id: 100, nodes: [1, 2], tags: {} },
    ],
  });

  const c = get(result, 0, 0);
  expect(idsOf(c).ways).toEqual([100]);
  expect(idsOf(c).nodes).toEqual([1, 2]);
});

test("SplitOSMData: 同じ要素が同じチャンクに重複して入らない", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 1) },
      // 同じ 2 ノードを 2 回参照する way
      { type: "way", id: 100, nodes: [1, 2, 1, 2], tags: {} },
    ],
  });

  for (const c of Object.values(result as Split)) {
    const ids = c.elements.map((e) => e.id);
    expect(new Set(ids).size, `重複あり: ${ids}`).toBe(ids.length);
  }
});

/**
 * 回帰: チャンク番号 0 を falsy と判定すると、最初のセルが登録先にならない
 * (`if (!chunkKey) continue` / `if (!idx)`)。
 */
test("SplitOSMData: 最初のセル (index 0) にも way とノードが入る", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 5) },
      { type: "way", id: 100, nodes: [1, 2], tags: {} },
    ],
  });

  // (0,0) は最初に見つかるチャンクなので内部インデックス 0 になる
  expect(idsOf(get(result, 0, 0))).toEqual({ ways: [100], nodes: [1, 2] });
  expect(idsOf(get(result, 0, 5))).toEqual({ ways: [100], nodes: [1, 2] });
});

/**
 * 回帰: 同じセルのノードを複数回する way で、way がチャンクに重複して入っていた
 * (重複排除用配列が長さ 0 で、書き込みが破棄されていた)。
 */
test("SplitOSMData: 同一セルのノードを重複参照する way は 1 回しか入らない", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 0) },
      { type: "way", id: 9, nodes: [1, 2, 1, 2], tags: {} },
    ],
  });

  expect(idsOf(get(result, 0, 0)).ways).toEqual([9]);
  expect(idsOf(get(result, 0, 0)).nodes).toEqual([1, 2]);
  expect(get(result, 0, 0).elements).toHaveLength(3);
});

/**
 * 回帰: 同じセルの 2 ノードで別々のチャンク名为作られていた
 * (`if (!idx)` で index 0 が falsy になるため、2 個目以降のノードが別チャンクになっていた)。
 */
test("SplitOSMData: 同じセルのノードは 1 つのチャンクにまとめられる", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 0) },
      { type: "node", id: 3, ...centerOf(0, 0) },
      { type: "way", id: 9, nodes: [1, 2, 3], tags: {} },
    ],
  });

  expect(Object.keys(result)).toEqual([keyOf(0, 0)]);
  expect(get(result, 0, 0).elements).toHaveLength(4);
});

/** 回帰: 重複排除が効いていないと、キャッシュの要素数が実データ比で膨張する */
test("SplitOSMData: 出力に重複要素が一切ない", () => {
  const result = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 1) },
      { type: "node", id: 3, ...centerOf(1, 0) },
      { type: "node", id: 4, ...centerOf(1, 1) },
      // 全セルをまたぎ、各ノードを 2 回ずつ参照する
      { type: "way", id: 100, nodes: [1, 2, 3, 4, 1, 2, 3, 4], tags: {} },
      { type: "way", id: 200, nodes: [1, 3, 2, 4], tags: {} },
    ],
  });

  for (const [k, chunk] of Object.entries(result as Split)) {
    const ids = chunk.elements.map((e) => `${e.type}${e.id}`);
    expect(new Set(ids).size, `重複あり (${k}): ${ids}`).toBe(ids.length);
  }
  // 4 セルすべてに way 2 本と 4 ノードが入る
  expect(Object.keys(result).length).toBe(4);
  for (const k of Object.keys(result)) {
    expect(get(result, 0, 0).elements.length).toBe(6);
    expect(idsOf(result[k]).ways).toEqual([100, 200]);
  }
});
