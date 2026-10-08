import { boundaryContains, divideBoundary, simplifyBoundaries, type Boundary } from "../../src/lib/osm/boundary";
import { expect, test } from "vitest";

function boundariesCovers(original: Boundary, divided: Boundary[]): boolean {
  const minLat = Math.min(...divided.map(x => x.minLat));
  const minLng = Math.min(...divided.map(x => x.minLng));
  const maxLat = Math.max(...divided.map(x => x.maxLat));
  const maxLng = Math.max(...divided.map(x => x.maxLng));

  return minLat <= original.minLat && minLng <= original.minLng
    && original.maxLat <= maxLat && original.maxLng <= maxLng;
}

test("boundaryContains", () => {
  const boundary: Boundary = {
    minLat: 0,
    maxLat: 1,
    minLng: 0,
    maxLng: 1,
  }
  const INCLUDE_LIST: App.Coordinate[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 0 },
    { lat: 1, lng: 1 },
    { lat: 0, lng: 0.9 },
    { lat: 0.9, lng: 0 },
    { lat: 0.9, lng: 0.9 },
    { lat: 0.5, lng: 0.5 },
  ];
  const EXCLUDE_LIST: App.Coordinate[] = [
    { lat: -0.1, lng: 0 },
    { lat: 0, lng: -0.1 },
    { lat: 1.1, lng: 0 },
    { lat: 0, lng: 1.1 },
    { lat: -0.1, lng: -0.1 },
    { lat: 1.1, lng: 1.1 },
    { lat: -0.1, lng: 1.1 },
    { lat: 1.1, lng: -0.1 },
  ];

  for (const coordinate of INCLUDE_LIST) {
    expect(boundaryContains(boundary, coordinate)).toBe(true);
  }

  for (const coordinate of EXCLUDE_LIST) {
    expect(boundaryContains(boundary, coordinate)).toBe(false);
  }
});

test("divideBoundary covers the original one", () => {
  for (let baseLat = 2; baseLat < 11; baseLat += 3) {
    for (let baseLng = 2; baseLng < 11; baseLng += 3) {
      for (let deltaLat = 0.01; deltaLat < 2; deltaLat += 0.3) {
        for (let deltaLng = 0.01; deltaLng < 2; deltaLng += 0.3) {
          const boundary: Boundary = {
            minLat: baseLat,
            minLng: baseLng,
            maxLat: baseLat + deltaLat,
            maxLng: baseLng + deltaLng,
          }

          const divided = divideBoundary(boundary);
          if (!boundariesCovers(boundary, divided)) {
            expect.fail(`failed ${baseLat} ${baseLng} ${deltaLat} ${deltaLng}`);
          }
        }
      }
    }
  }
})


test("simplifyBoundaries(divided boundaries) === original boundary", () => {
  const boundary: Boundary = {
    minLat: 2,
    minLng: 2,
    maxLat: 3,
    maxLng: 3,
  }

  const divided = divideBoundary(boundary);
  const simplified = simplifyBoundaries(divided);

  expect(simplified.length).toBe(1);
  expect(simplified[0]).toEqual(boundary);

})
