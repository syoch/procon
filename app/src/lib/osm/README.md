# OSM Cache

OSM から取得した地図情報をキャッシュする仕組み
取得経路は検索経路 (`requireOSMData`) と、失効したキャッシュを取り直す定期更新 (`refreshExpiredOSMCache`) の 2 経路がある

## 検索経路

1. 取得対象範囲の Boundary を囲うように適当なグリッドで丸めグリッド上の要素ごとに分解する
2. それらのグリッドのうち有効なキャッシュが存在しないようなグリッド (新規グリッド) を集める
   - 壊れた JSON (パース不能・形が違う) は新規とみなして取り直す
3. 新規グリッドを長方形領域である程度簡約化する
4. 簡約化した領域情報を基に OSM 側からデータを取得する (新規地図情報)
5. 新規地図情報をキャッシュに保存する
6. 新規地図情報とキャッシュに存在していたグリッドをマージする
7. 取得した OSMData の way について取得対象範囲外にあるものをトリムする (孤立ノードの削除を含む)
8. トリムした OSMData を返す

セルは `OSM_CACHE_DIR/{minLat}-{minLng}-{maxLat}-{maxLng}.json` というファイルに
1 セル 1 ファイルで保存する。

## 取得時刻と TTL

セルがいつ取得されたかは**ファイル mtime** で保持する。

`OSM_CACHE_TTL_DAYS` の解釈:

| 値                                           | 結果                 |
| -------------------------------------------- | -------------------- |
| 未設定・空文字                               | 30 日                |
| `0`                                          | 失効させない         |
| `30日` / `-0` / `1e301` などの解釈できない値 | 警告して 30 日に倒す |

`0` と不正値を区別するのは、不正値を「失効しない」側に倒すと
`OSM_CACHE_TTL_DAYS=30日` という打ち間違いで更新がログも残らず永久に止まるため。
`1e301` は日数の値としては有限でもミリ秒に換算すると `Infinity` になるので、
積のほうも検証している。

## `remark` による取得の失敗判定

Overpass はエラーを HTTP status で伝えず、`remark` として返す（status は 200 のまま）。
`fetchOverpassData` は `remark` があれば throw する。

このクエリは `out` 文が 2 つあるので、`out body` で way が写出された後に
`>` や 2 つ目の `out` が timeout / OOM になると、要素が一部だけ入ったまま
`remark` が付く。実測でも `ways=7008 / nodes=0` + `remark` のような応答が得られる。

これを返すと欠けたデータがキャッシュに保存され、TTL が解けて不完全な地図が
TTL の間使われる。失敗として扱うのはこのため。応答全体に対する例外なので、
セル単位のカウントにはしない。

## 一時ファイル

`saveCache` は `{base}-tmp.{pid}.{seq}.json` に書いてから `rename` することで、 atomic に更新する。
プロセスが `rename` 前に死ぬ（SIGKILL / OOM）と一時ファイルが残る。
更新ジョブの冒頭で **1 時間以上古いものだけ**削除する（削除件数は journal に出る）。
`my-important-tmp.backup.json` のような無関係なファイルは消さない。

## 既知の制約

- **同時失効（thundering herd）**: セルは探索された時点で入るので TTL も一斉に満了する。
  猶予 30 日が経過すると全セルが同じ実行で失効し、1 クエリに大量の bbox 句が詰まる。
  1 回の更新で扱う失効セルは `MAX_OSM_CELLS` 枚までなので、残りは次回の実行に回る。
  それでも 1 クエリの応答は 1 個の `App.OSMData` として実体化するため、
  上限値を実測ログ（`log_lines`）で見直す余地がある
- **クライアント側に時間予算がある**: `fetch` は `OSM_FETCH_BUDGET_MS` で切れる。
  切れたときは `requireOSMData` がキャッシュ済みの分だけで続行する
- **`remark` の付かない空応答は検出できない**: 上記 `remark` 検査で防げない経路
  （プロキシ異常など）で空が来ると、30 日間そのままキャッシュされる
- **eviction（使われなくなったセルの削除）は未実装**。TTL は上書きのみ

## データフロー

```mermaid
graph
    OriginalBoundary["targetBoundary (Boundary)"]
    subgraph requireOSMData
        MergedOSMData["mergedOSMData (OSMData)"]
        OriginalBoundary --divideBoundary--> dividedBoundaries

        boundariesToGet["boundariesToGet (Boundary[])"]
        boundariesToQuery["boundariesToQuery (Boundary[])"]
        requiredMapData["requiredMapData (OSMData)"]
        cachedMapData["cachedMapData (OSMData[])"]

        dividedBoundaries --readCache--> cacheReadResult

        cacheReadResult --if NoCacheAvailable--> boundariesToGet
        cacheReadResult --if OSMData--> cachedMapData
        boundariesToGet --simplifyBoundaries--> boundariesToQuery
        boundariesToQuery --require--> requiredMapData
        requiredMapData --saveCache--> Void00000["void"]
        cachedMapData --> MergedOSMData
        requiredMapData --> MergedOSMData
    end
    ResultMapData["result (MapData)"]
    MergedOSMData --TrimOSMData --> ResultMapData

    subgraph refreshExpiredOSMCache ["refreshExpiredOSMCache (定期更新)"]
        CachedCells["listCachedOSMCells (mtime)"]
        Expired["expired (TTL 超過)"]
        Saved["saveCache (空でも保存)"]
        CachedCells --> Expired
        Expired --1クエリ--> Saved
    end
```
