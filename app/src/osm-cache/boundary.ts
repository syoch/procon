// 浮動小数点数誤差を避けるために 2 の累乗の分割をするといい
const deltaLatitude = 0.015625; // 1/64
const deltaLongitude = 0.015625; // 1/64

export type Boundary = {
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
};

export function divideBoundary(boundary: Boundary): Boundary[] {
    const baseLat = Math.floor(boundary.minLat / deltaLatitude) * deltaLatitude;
    const baseLng = Math.floor(boundary.minLng / deltaLongitude) * deltaLongitude;
    const latDivisions = Math.ceil((boundary.maxLat - baseLat) / deltaLatitude);
    const lngDivisions = Math.ceil((boundary.maxLng - baseLng) / deltaLongitude);

    return [...Array(latDivisions)].map((_, latIndex) =>
        [...Array(lngDivisions)].map((_, lngIndex) => ({
            minLat: baseLat + latIndex * deltaLatitude,
            minLng: baseLng + lngIndex * deltaLongitude,
            maxLat: baseLat + (latIndex + 1) * deltaLatitude,
            maxLng: baseLng + (lngIndex + 1) * deltaLongitude,
        }))
    ).flat();
}

// 隣接する Boundary をまとめてより少ない Boundary での表現を得る
// 制約: それぞれの boundary の minLat, minLng はグリッド境界上にあり、大きさは 1x1
export function simplifyBoundary(boundaries: Boundary[]): Boundary[] {
    // 未処理の Boundary の配置を保存した Map
    const boundaryMap: Set<string> = new Set();
    for (const bound of boundaries) {
        const latIndex = Math.floor(bound.minLat / deltaLatitude);
        const lngIndex = Math.floor(bound.minLng / deltaLongitude);
        boundaryMap.add(`${latIndex},${lngIndex}`);
    }
    const hasBoundary = (latIndex: number, lngIndex: number) => boundaryMap.has(`${latIndex},${lngIndex}`);
    const deleteBoundary = (latIndex: number, lngIndex: number) => boundaryMap.delete(`${latIndex},${lngIndex}`);

    const result: Boundary[] = []
    while (boundaryMap.size > 0) {
        const leaderBlock = boundaryMap.keys().next().value;
        if (!leaderBlock) break;

        boundaryMap.delete(leaderBlock);

        const [lat, lng] = leaderBlock.split(',').map(Number);
        const latList = [lat];
        const lngList = [lng];
        console.log(latList, lngList)

        while (lngList.every(lng => hasBoundary(latList[0] - 1, lng))) {
            lngList.forEach(lng => deleteBoundary(latList[0] - 1, lng))
            latList.unshift(latList[0] - 1)
        }

        while (latList.every(lat => hasBoundary(lat, lngList[0] - 1))) {
            latList.forEach(lat => deleteBoundary(lat, lngList[0] - 1))
            lngList.unshift(lngList[0] - 1)
        }

        while (lngList.every(lng => hasBoundary(latList[latList.length - 1] + 1, lng))) {
            lngList.forEach(lng => deleteBoundary(latList[latList.length - 1] + 1, lng))
            latList.push(latList[latList.length - 1] + 1)
        }

        while (latList.every(lat => hasBoundary(lat, lngList[lngList.length - 1] + 1))) {
            latList.forEach(lat => deleteBoundary(lat, lngList[lngList.length - 1] + 1))
            lngList.push(lngList[lngList.length - 1] + 1)
        }

        result.push({
            minLat: deltaLatitude * (latList[0]),
            maxLat: deltaLatitude * (latList[latList.length - 1] + 1),
            minLng: deltaLongitude * (lngList[0]),
            maxLng: deltaLongitude * (lngList[lngList.length - 1] + 1),
        })
    }

    return result;
}