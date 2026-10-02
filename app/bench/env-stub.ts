/**
 * `$env/dynamic/private` の bench 用差し替え。
 *
 * `fs-cache-manager` などは import 時に環境変数を読むため、bench からは
 * `process.env` 経由で差し込めるようにしておく（`cache-read` シナリオが
 * 実行時に `OSM_CACHE_DIR` を上書きする）。
 */
export const env: Record<string, string | undefined> = new Proxy(
  {},
  {
    get: (_target, key: string) => process.env[key],
    has: (_target, key: string) => key in process.env,
    ownKeys: () => Reflect.ownKeys(process.env),
    getOwnPropertyDescriptor: (_target, key: string) => ({
      value: process.env[key],
      enumerable: true,
      configurable: true,
    }),
  },
);
