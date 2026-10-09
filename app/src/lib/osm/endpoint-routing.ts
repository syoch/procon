import type { Boundary } from "./boundary";
import { env } from "$env/dynamic/private";

/**
 * セル（厳密にはセルの集合である長方形）を、自前 Overpass の担当と
 * 外部ミラーの担当に振り分ける。
 *
 * **セルは分割しない。** 1 つの長方形は丸ごとどちらか一方へ送る。
 * 部分的な取得が起きないので、部分セルができる余地がない。
 *
 * ```text
 * 完全にカバレッジ内   -> 自前
 * 完全に外             -> 外部
 * カバレッジを跨ぐ     -> 外部（丸ごと）
 * ```
 *
 * 跨ぐ長方形はカバレッジの縁にしか出ない。日本の bbox の縁は大半が海なので、
 * 外部へ回しても実害が小さい。
 */
export type RoutedBoundaries = {
    /** カバレッジに完全に含まれる。自前 `OSM_SELF_HOSTED_ENDPOINT` が担当する */
    selfHosted: Boundary[];
    /** カバレッジの外、跨ぐもの、またはカバレッジ未設定。`OVERPASS_ENDPOINT` が担当する */
    fallback: Boundary[];
};

/**
 * `inner` が `outer` に完全に含まれるか。
 * 境界が一致する場合は含まれるとみなす。
 */
export function containsBoundary(outer: Boundary, inner: Boundary): boolean {
    return outer.minLat <= inner.minLat
        && inner.maxLat <= outer.maxLat
        && outer.minLng <= inner.minLng
        && inner.maxLng <= outer.maxLng;
}

/**
 * 各 boundary をカバレッジの内外に振り分ける。**分割はしない。**
 *
 * `coverage` が null なら全て fallback に回す。
 * これが `OSM_SELF_HOSTED_ENDPOINT` 未設定時の現行挙動（後方互換）になる。
 */
export function routeBoundaries(boundaries: Boundary[], coverage: Boundary | null): RoutedBoundaries {
    if (coverage === null) {
        return { selfHosted: [], fallback: [...boundaries] };
    }
    const selfHosted: Boundary[] = [];
    const fallback: Boundary[] = [];
    for (const boundary of boundaries) {
        if (containsBoundary(coverage, boundary)) {
            selfHosted.push(boundary);
        } else {
            fallback.push(boundary);
        }
    }
    return { selfHosted, fallback };
}

export type SelfHostedConfig = { endpoint: string; coverage: Boundary };

/** `selfHostedConfig` の結果。同じ設定の間は再計算しない */
let selfHostedCache: { key: string; value: SelfHostedConfig | null } | null = null;

/**
 * 自前 Overpass の設定を env から読む。
 *
 * `OSM_SELF_HOSTED_ENDPOINT` が未設定なら null（現行の挙動）。
 * endpoint はあるが `OSM_SELF_HOSTED_COVERAGE` が無効なら null を返し、警告する。
 * 誤ってカバレッジ外を自前へ送らないため、無効値を日本全体などに倒さない。
 *
 * 設定値の組み合わせごとに 1 度だけ計算する。
 * 毎リクエスト計算すると、無効な値の警告が取得のたびに出る。
 */
export function selfHostedConfig(): SelfHostedConfig | null {
    const endpoint = env.OSM_SELF_HOSTED_ENDPOINT;
    const rawCoverage = env.OSM_SELF_HOSTED_COVERAGE;
    const key = `${endpoint ?? ""}\u0000${rawCoverage ?? ""}`;
    if (selfHostedCache !== null && selfHostedCache.key === key) {
        return selfHostedCache.value;
    }

    let value: SelfHostedConfig | null = null;
    if (endpoint) {
        const coverage = parseCoverage(rawCoverage);
        if (coverage === null) {
            console.warn(
                "OSM_SELF_HOSTED_ENDPOINT は設定されていますが OSM_SELF_HOSTED_COVERAGE が無効なため、外部ミラーだけを使います",
            );
        } else {
            value = { endpoint, coverage };
        }
    }
    selfHostedCache = { key, value };
    return value;
}

/**
 * その boundary を自前 Overpass が担当するか。担当するのは「完全に内」だけ。
 *
 * キャッシュの判定に使う。自前の結果はキャッシュしない。
 * 跨ぐものは外部が担当するので false（外部の結果としてキャッシュしてよい）。
 */
export function isSelfHostedBoundary(bound: Boundary): boolean {
    const config = selfHostedConfig();
    return config !== null && containsBoundary(config.coverage, bound);
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