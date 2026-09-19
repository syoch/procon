import { expect, test, vi } from "vitest";
import type { Boundary } from "../../src/routes/api/osm/boundary";
import { requireOSMData } from "../../src/routes/api/osm";

const BOUNDARY: Boundary = {
  minLat: 0 / 64,
  minLng: 0 / 64,
  maxLat: 2 / 64,
  maxLng: 2 / 64,
};
const CACHED_BOUNDARY: Boundary[] = [
  {
    minLat: 0 / 64,
    minLng: 0 / 64,
    maxLat: 1 / 64,
    maxLng: 1 / 64,
  },
  {
    minLat: 1 / 64,
    minLng: 0 / 64,
    maxLat: 2 / 64,
    maxLng: 1 / 64,
  }
];
const UNCACHED_BOUNDARY: Boundary[] = [
  {
    minLat: 0 / 64,
    minLng: 1 / 64,
    maxLat: 1 / 64,
    maxLng: 2 / 64,
  },
  {
    minLat: 1 / 64,
    minLng: 1 / 64,
    maxLat: 2 / 64,
    maxLng: 2 / 64,
  }
];

// simplifyBoundaries で境界がまとめられるはずなので 1 つの Boundary で fetchOSM が呼ばれるはず
const QUERY_BOUNDARY: Boundary[] = [
  {
    minLat: 0 / 64,
    minLng: 1 / 64,
    maxLat: 2 / 64,
    maxLng: 2 / 64,
  }
];

const readCache = vi.fn().mockImplementation(async (bound: Boundary) => {
  for (const cached of CACHED_BOUNDARY) {
    if (cached.minLat === bound.minLat && cached.minLng === bound.minLng) {
      return { elements: [] };
    }
  }
  return null;
});
const saveCache = vi.fn();
const fetchOSM = vi.fn().mockImplementation(async _ => ({ elements: [] }));

test("requireOSMData", async () => {
  await requireOSMData(BOUNDARY, { readCache, saveCache }, fetchOSM);
  expect(readCache).toHaveBeenCalledTimes(4);
  expect(readCache).calledWith(CACHED_BOUNDARY[0]);
  expect(readCache).calledWith(CACHED_BOUNDARY[1]);
  expect(readCache).calledWith(UNCACHED_BOUNDARY[0]);
  expect(readCache).calledWith(UNCACHED_BOUNDARY[1]);
  expect(saveCache).toHaveBeenCalledTimes(2);
  expect(saveCache).calledWith(UNCACHED_BOUNDARY[0], { elements: [] });
  expect(saveCache).calledWith(UNCACHED_BOUNDARY[1], { elements: [] });
  expect(fetchOSM).toHaveBeenCalledTimes(1);
  expect(fetchOSM).calledWith(QUERY_BOUNDARY);
});
