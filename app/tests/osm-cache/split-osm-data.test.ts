import { expect, test } from "vitest";
import { SplitOSMData, trimOSMData } from "../../src/routes/api/osm/osm-data";
import { divideBoundary, type Boundary } from "../../src/routes/api/osm/boundary";
import { deltaLatitude, deltaLongitude } from "../../src/routes/api/osm/grid";

const D_LAT = deltaLatitude;
const D_LNG = deltaLongitude;

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

/** チャンクを (minLat,minLng) で引けるようにする。trimOSMData との突き合わせに使う */
function chunkMap(chunks: ReturnType<typeof SplitOSMData>) {
  return new Map(chunks.map((c) => [`${c.lat},${c.lng}`, c.map]));
}

function idsOf(data: App.OSMData) {
  return {
    ways: data.elements.filter((e) => e.type === "way").map((e) => e.id).sort((a, b) => a - b),
    nodes: data.elements.filter((e) => e.type === "node").map((e) => e.id).sort((a, b) => a - b),
  };
}

test("SplitOSMData は空データに空配列を返す", () => {
  expect(SplitOSMData({ elements: [] })).toEqual([]);
  expect(SplitOSMData({ elements: [{ type: "way", id: 1, nodes: [], tags: {} }] })).toEqual([]);
});

test("SplitOSMData はノードをセルごとに分ける", () => {
  const chunks = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(3, 4) },
      { type: "node", id: 3, ...centerOf(0, 0) },
    ],
  });

  expect(chunks.length).toBe(2);
  const m = chunkMap(chunks);
  expect(idsOf(m.get("0,0")!).nodes).toEqual([1, 3]);
  expect(idsOf(m.get(`${3 * D_LAT},${4 * D_LNG}`)!).nodes).toEqual([2]);
});

test("SplitOSMData の返す lat/lng はセルの左下隅で divideBoundary と一致する", () => {
  const chunks = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(2, 3) },
      { type: "node", id: 2, ...centerOf(5, 1) },
    ],
  });

  const expectedKeys = new Set(["2,3", "5,1"].map((k) => {
    const [a, b] = k.split(",").map(Number);
    return `${a * D_LAT},${b * D_LNG}`;
  }));
  const actualKeys = new Set(chunks.map((c) => `${c.lat},${c.lng}`));

  expect(actualKeys).toEqual(expectedKeys);

  // divideBoundary が同じ格子から作るセルと座標が一致する
  const region: Boundary = {
    minLat: 2 * D_LAT, maxLat: 6 * D_LAT,
    minLng: 1 * D_LNG, maxLng: 4 * D_LNG,
  };
  const dividedKeys = new Set(divideBoundary(region).map((b) => `${b.minLat},${b.minLng}`));
  for (const key of actualKeys) expect(dividedKeys.has(key)).toBe(true);
});

test("SplitOSMData: way はノードが1つでもセル内にあれば含まれ、参照ノードも入る", () => {
  const chunks = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(0, 5) },
      { type: "way", id: 100, nodes: [1, 2], tags: { highway: "residential" } },
    ],
  });

  const m = chunkMap(chunks);
  // way はセル (0,0) のノードに接するので (0,0) と (0,5) の両方に残る
  for (const key of [`0,0`, `${0 * D_LAT},${5 * D_LNG}`]) {
    const c = m.get(key)!;
    expect(idsOf(c).ways).toEqual([100]);
    // way が参照するノードは自分のセル外でも入る
    expect(idsOf(c).nodes).toEqual([1, 2]);
  }
});

test("SplitOSMData: 全ノードがセル外の way は含まれない", () => {
  // (0,0) のチャンクは存在させる（way 200 のノードは別の 2 セルにある）
  const chunks = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(9, 9) },
      { type: "node", id: 3, ...centerOf(8, 8) },
      { type: "way", id: 200, nodes: [2, 3], tags: {} },
    ],
  });

  const m = chunkMap(chunks);
  expect(idsOf(m.get("0,0")!).ways).toEqual([]);
  // way 200 は自分のノードがある 2 セルにだけ入る
  expect(idsOf(m.get(`${9 * D_LAT},${9 * D_LNG}`)!).ways).toEqual([200]);
  expect(idsOf(m.get(`${8 * D_LAT},${8 * D_LNG}`)!).ways).toEqual([200]);
});

test("SplitOSMData: セルをまたぐ way は各チャンクに含まれる", () => {
  const chunks = SplitOSMData({
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(3, 3) },
      { type: "way", id: 300, nodes: [1, 2], tags: {} },
    ],
  });

  const m = chunkMap(chunks);
  expect(idsOf(m.get("0,0")!).ways).toEqual([300]);
  expect(idsOf(m.get(`${3 * D_LAT},${3 * D_LNG}`)!).ways).toEqual([300]);
});

test("SplitOSMData: 未知の type は無視される", () => {
  const elements = [
    { type: "node", id: 1, ...centerOf(0, 0) },
    { type: "way", id: 2, nodes: [1], tags: {} },
    { type: "relation", id: 3, members: [] },
  ] as unknown as App.OSMData["elements"];
  const chunks = SplitOSMData({ elements });

  for (const c of chunks) {
    expect(c.map.elements.map((e) => (e as { type: string }).type)).not.toContain("relation");
  }
});

test("SplitOSMData: 負座標でも正しいセルに入る", () => {
  const chunks = SplitOSMData({
    elements: [
      { type: "node", id: 1, lat: -0.5 * D_LAT, lon: -0.5 * D_LNG },
      { type: "node", id: 2, lat: -3.5 * D_LAT, lon: -1.5 * D_LNG },
    ],
  });

  const m = chunkMap(chunks);
  expect(idsOf(m.get(`${-1 * D_LAT},${-1 * D_LNG}`)!).nodes).toEqual([1]);
  expect(idsOf(m.get(`${-4 * D_LAT},${-2 * D_LNG}`)!).nodes).toEqual([2]);
});

test("SplitOSMData: trimOSMData をセルごとに適用した結果と一致する", () => {
  // セル境界上にノードが乗らないよう、すべて中心座標を使う
  const cells: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 3]];
  const nodes: App.OSMRawNode[] = cells.map(([a, b], i) => ({ type: "node", id: i + 1, ...centerOf(a, b) }));
  // セルをまたぐ way と、1 セルに閉じた way
  const way = (id: number, nodes: number[], tags: Record<string, string> = {}): App.OSMRawWay =>
    ({ type: "way", id, nodes, tags });
  const ways: App.OSMRawWay[] = [
    way(100, [1, 7], { highway: "primary" }),
    way(101, [1, 2], { highway: "residential" }),
    way(102, [3, 4]),
    way(103, [5, 6]),
  ];
  const data: App.OSMData = { elements: [...nodes, ...ways] };

  const chunks = chunkMap(SplitOSMData(data));
  for (const [a, b] of cells) {
    const cell = cellOf(a, b);
    const expected = idsOf(trimOSMData(data, cell));
    const actualChunk = chunks.get(`${cell.minLat},${cell.minLng}`);
    expect(actualChunk, `セル (${a},${b}) のチャンクが見つからない`).toBeDefined();
    expect(idsOf(actualChunk!), `セル (${a},${b}) が trim と一致しない`).toEqual(expected);
  }
});

test("SplitOSMData: チャンク間で要素が失われない", () => {
  const data: App.OSMData = {
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, ...centerOf(4, 4) },
      { type: "way", id: 100, nodes: [1, 2], tags: {} },
      // どのセルにも属さない孤立ノード。way から参照されないので trim で消える
      { type: "node", id: 3, ...centerOf(8, 8) },
    ],
  };

  const chunks = SplitOSMData(data);
  const wayIds = new Set(chunks.flatMap((c) => c.map.elements.filter((e) => e.type === "way").map((e) => e.id)));
  expect(wayIds).toEqual(new Set([100]));
  // 孤立ノードのセルは生成される（way が無くてもノードがあれば作られる）
  expect(chunks.map((c) => `${c.lat},${c.lng}`)).toContain(`${8 * D_LAT},${8 * D_LNG}`);
});

test("SplitOSMData: ノードのないセルはチャンクを生成しない", () => {
  // 16 セルのうちノードが入る 1 セルだけ
  const region: Boundary = {
    minLat: 0, maxLat: 4 * D_LAT,
    minLng: 0, maxLng: 4 * D_LNG,
  };
  const cells = divideBoundary(region);
  const chunks = SplitOSMData({ elements: [{ type: "node", id: 1, ...centerOf(0, 0) }] });

  expect(cells.length).toBe(16);
  expect(chunks.length).toBe(1);

  // 保存側は boundariesToGet の全セルを保存するので、欠けたセルは呼び出し側で補う
  const covered = new Set(chunks.map((c) => `${c.lat},${c.lng}`));
  const missing = cells.filter((c) => !covered.has(`${c.minLat},${c.minLng}`));
  expect(missing.length).toBe(15);
  // 補う値は trim 相当の空データ
  expect(idsOf(trimOSMData({ elements: [{ type: "node", id: 1, ...centerOf(0, 0) }] }, missing[0]))).toEqual({ ways: [], nodes: [] });
});

test("SplitOSMData: グリッド境界上のノードは上位セルにのみ属する (trimOSMData は両セルに含む)", () => {
  // trimOSMData は両端を含むので境界上のノードは隣接セル双方に入るが、
  // SplitOSMData は Math.floor で一意に振り分ける（重複しない）
  const data: App.OSMData = {
    elements: [{ type: "node", id: 1, lat: D_LAT, lon: D_LNG }],
  };

  const chunks = SplitOSMData(data);
  expect(chunks.length).toBe(1);
  expect(chunks[0].lat).toBe(D_LAT);
  expect(chunks[0].lng).toBe(D_LNG);

  // 対照: trimOSMData は 2 セルともに入る
  expect(trimOSMData(data, cellOf(0, 0)).elements.length).toBe(1);
  expect(trimOSMData(data, cellOf(1, 1)).elements.length).toBe(1);
});

test("SplitOSMData: 境界上のノードを way が参照しても必要なチャンクには入る", () => {
  // 境界上のノードは「セルの元になるノード」としては数えられないが、
  // way が参照していれば outputNodes 経由でチャンクに入る
  const data: App.OSMData = {
    elements: [
      { type: "node", id: 1, ...centerOf(0, 0) },
      { type: "node", id: 2, lat: D_LAT, lon: D_LNG },
      { type: "way", id: 100, nodes: [1, 2], tags: {} },
    ],
  };

  const chunks = chunkMap(SplitOSMData(data));
  expect(idsOf(chunks.get("0,0")!).ways).toEqual([100]);
  expect(idsOf(chunks.get("0,0")!).nodes).toEqual([1, 2]);
});