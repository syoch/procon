import { divideBoundary, simplifyBoundary, type Boundary } from "../../src/routes/api/osm/boundary";

function boundariesCovers(original: Boundary, divided: Boundary[]): boolean {
  const minLat = Math.min(...divided.map(x => x.minLat));
  const minLng = Math.min(...divided.map(x => x.minLng));
  const maxLat = Math.max(...divided.map(x => x.maxLat));
  const maxLng = Math.max(...divided.map(x => x.maxLng));

  return minLat <= original.minLat && minLng <= original.minLng
    && original.maxLat <= maxLat && original.maxLng <= maxLng;
}

function testDivideBoundary() {
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
            console.log(`failed ${baseLat} ${baseLng} ${deltaLat} ${deltaLng}`)
          }
        }
      }
    }
  }
}

function testSimplifyBoundary() {
  const boundary: Boundary = {
    minLat: 2,
    minLng: 2,
    maxLat: 3,
    maxLng: 3,
  }

  const divided = divideBoundary(boundary);
  const simplified = simplifyBoundary(divided);

  console.log(simplified);
}
testSimplifyBoundary();