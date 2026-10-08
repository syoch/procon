import type { Boundary } from "./boundary";

/**
 * セル（厳密にはセルの集合である長方形）を、自前 Overpass の担当と
 * 外部ミラーの担当に振り分ける。
 *
 * **空の応答で判定しない。** 座標とカバレッジ矩形を比べて決める。
 * 自前に投げて空なら外部へ、という判定は「道が無い場所」と
 * 「DB の外」を区別できない。DB の外を空としてキャッシュすると
 * 地図が欠けたまま TTL の間使われる。
 */
export type RoutedBoundaries = {
    /** カバレッジの中。自前 `OSM_SELF_HOSTED_ENDPOINT` が担当する */
    selfHosted: Boundary[];
    /** カバレッジの外、またはカバレッジ未設定。`OVERPASS_ENDPOINT` が担当する */
    fallback: Boundary[];
};

/** 2 つの長方形の重なり。重なりが無ければ null */
export function intersect(a: Boundary, b: Boundary): Boundary | null {
    const minLat = Math.max(a.minLat, b.minLat);
    const maxLat = Math.min(a.maxLat, b.maxLat);
    const minLng = Math.max(a.minLng, b.minLng);
    const maxLng = Math.min(a.maxLng, b.maxLng);
    if (minLat >= maxLat || minLng >= maxLng) return null;
    return { minLat, maxLat, minLng, maxLng };
}

/**
 * `a` のうち `b` に含まれない部分。最大 4 つの重なりのない長方形に分ける。
 * `b` が `a` を覆うなら空配列。
 */
export function subtract(a: Boundary, b: Boundary): Boundary[] {
    const overlap = intersect(a, b);
    if (overlap === null) return [a];

    const out: Boundary[] = [];
    // 左（経度が小さい側）
    if (a.minLng < overlap.minLng) {
        out.push({ minLat: a.minLat, maxLat: a.maxLat, minLng: a.minLng, maxLng: overlap.minLng });
    }
    // 右（経度が大きい側）
    if (overlap.maxLng < a.maxLng) {
        out.push({ minLat: a.minLat, maxLat: a.maxLat, minLng: overlap.maxLng, maxLng: a.maxLng });
    }
    // 下（重なりの経度範囲に限る。左右で既に取った分と重ならないため）
    if (a.minLat < overlap.minLat) {
        out.push({ minLat: a.minLat, maxLat: overlap.minLat, minLng: overlap.minLng, maxLng: overlap.maxLng });
    }
    // 上
    if (overlap.maxLat < a.maxLat) {
        out.push({ minLat: overlap.maxLat, maxLat: a.maxLat, minLng: overlap.minLng, maxLng: overlap.maxLng });
    }
    return out;
}

/**
 * 各 boundary をカバレッジの内外に振り分ける。
 *
 * `coverage` が null なら全て fallback に回す。
 * これが `OSM_SELF_HOSTED_ENDPOINT` 未設定時の現行挙動（後方互換）になる。
 *
 * カバレッジの境界はセル境界に揃えておくのが前提。
 * 揃っていなくても `subtract` が跨ぎを分割するが、
 * その場合は 1 セルが両方に載るため冗長になる。
 */
export function routeBoundaries(boundaries: Boundary[], coverage: Boundary | null): RoutedBoundaries {
    if (coverage === null) {
        return { selfHosted: [], fallback: [...boundaries] };
    }
    const selfHosted: Boundary[] = [];
    const fallback: Boundary[] = [];
    for (const boundary of boundaries) {
        const inside = intersect(boundary, coverage);
        if (inside !== null) selfHosted.push(inside);
        fallback.push(...subtract(boundary, coverage));
    }
    return { selfHosted, fallback };
}

/**
 * `OSM_SELF_HOSTED_COVERAGE` の値を読む。
 *
 * 形式は `minLat,minLng,maxLat,maxLng` のカンマ区切り。
 * 未設定・空文字・解釈できない値は null を返し、警告する。
 * 誤った値を「日本全体」などに倒さない。倒すとカバレッジ外のセルを
 * 自前へ送って空キャッシュを作る。
 */
export function parseCoverage(raw: string | undefined): Boundary | null {
    if (raw === undefined || raw.trim() === "") {
        return null;
    }
    const parts = raw.split(",").map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        console.warn(
            `OSM_SELF_HOSTED_COVERAGE="${raw}" を解釈できないため、自前 Overpass を使いません`,
        );
        return null;
    }
    const [minLat, minLng, maxLat, maxLng] = parts;
    if (minLat >= maxLat || minLng >= maxLng) {
        console.warn(
            `OSM_SELF_HOSTED_COVERAGE="${raw}" の上下・左右が逆です。自前 Overpass を使いません`,
        );
        return null;
    }
    return { minLat, maxLat, minLng, maxLng };
}