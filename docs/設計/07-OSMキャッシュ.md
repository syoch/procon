# OSM 取得結果キャッシュの設計

OSM の Overpass API 応答をサーバ側でディスクにキャッシュする仕組み。
Issue #60 / PR #61 で実装（2026-09-18）。

## なぜサーバ側に置くか

ブラウザから直接 Overpass API を叩くと、公開インスタンスにリクエストが集中する。
サーバが一度取得して共有する形に組み替えた。

## 配置

`app/src/routes/api/osm/` にサーバ側プロキシとディスクキャッシュを実装。

## クエリの範囲

**`way["highway"](bbox)` に限定する。** タグ指定なしの `way(bbox)` だと建物等も
取得することになり、応答が約 2 倍になる。

リクエスト時に `wayHighwayExcludes` で highway 種別フィルタをかけるので、
取得側は広く取ってよい。

## タイル分割と取得手順

1. タイルを 1/64°（0.015625）単位に分割する
2. 欠けているタイルだけ.collection まとめて union クエリで取得する
3. タイル単位で trim して保存する
4. 必要なタイルを merge する
5. 最後に一度 trim する

境界を跨ぐタイルは union でまとめて取ることで、1 回のクエリで済ませる。

## 環境変数

`$env/dynamic/private` から読む。

| 変数 | 必須 |
|---|---|
| `OSM_CACHE_DIR` | 任意 |
| `OVERPASS_ENDPOINT` | 必須 |

**遅延取得にすること。** module 直下で throw すると SvelteKit の postbuild `analyse`
が import 時に落ちるため、`pnpm run build` も nix build も失敗する。

## デプロイ

- systemd unit に `Environment=OSM_CACHE_DIR=/var/cache/procon/osm` _Write
- `EnvironmentFile=/etc/procon.env` を指定し、その中に `OVERPASS_ENDPOINT` を入れる
  （setup-script では作成していないので、運用で用意する）
- `/var/cache/procon/osm` は procon 所有で作成する

## TTL / eviction / versioning は意図的に未実装

固定エリアで緩やかに OSM が更新される前提では実害が出にくいため、実装していない。

**見直しトリガ:**

- 対応エリアを大幅に拡大する
- 最新 OSM の反映が必要になった
- クエリの意味が変わる

リセットは `OSM_CACHE_DIR` を消せばよい。

## 既知の残課題

| 課題 | 内容 |
|---|---|
| `EnvironmentFile` | `-` を付けないとファイルが必須。未作成だと unit が起動しない |
| boundary テスト | `console.log` のみ |
| zod エラー | 整形されていない |
| bbox 範囲チェック | 未実装 |