# データフロー図

```mermaid
flowchart LR
  subgraph External["外部データ"]
    OSM_API[("Overpass API<br/>(OSM 生データ)")]
    PLACE_DB[("場所 DB<br/>(地名辞書)")]
  end

  subgraph Load["1. データ取得 & グラフ構築"]
    OSM_LOADER["osm-loader.js<br/>fetch + overpass-ql-ts"]
    OSM_GRAPH[("OSMGraph<br/>{MapNode, OSMEdge}")]
  end

  subgraph Cross["2. 交差点抽出"]
    CROSS["extractIntersections<br/>・次数≥3 → SCC 置換<br/>・エッジ付け替え"]
    CROSSED_GRAPH[("CrossedGraph<br/>{MapNode+crossNode,<br/>OSMEdge}")]
  end

  subgraph Fold["3. 次数2 畳み込み"]
    FOLD["foldDegree2Edges<br/>・次数2連鎖を圧縮<br/>・属性変化点で分割<br/>・curve_score 算出"]
    SEARCH_GRAPH[("SearchGraph<br/>{MapVCrossNode,<br/>FoldedEdge, ComputedEdge}")]
  end

  subgraph Runtime["4. 実行時処理"]
    SPLIT["Transient Split<br/>・最近傍エッジ投影<br/>・セグメント分割<br/>・曲率再計算"]
    COST_CALC["cost-calculator.js<br/>・幅員/視界/混在/狭さ<br/>・セグメント反復 → score"]
    PATH_FINDER["path-finder.js<br/>Dijkstra 法<br/>cost = 距離×(1+λ×(1-総合スコア))"]
  end

  subgraph Resolver["名前解決"]
    NAME_RESOLVER["name_resolver.js<br/>Nominatim / 地名辞書"]
    LOCATION_MAP[("LocationMap<br/>名前→{lng, lat}")]
  end

  subgraph UI["UI 層"]
    PARAMS[("Params<br/>α₁, α₂, α₃, α₄, λ")]
    NAVI_APP["navi-app.js"]
    MAP["Leaflet 地図<br/>・polyline 描画<br/>・最短経路比較"]
    DEBUG["debug UI<br/>raw_node.js"]
    SEARCH_BOX["名前→座標入力"]
  end

  OSM_API --> OSM_LOADER
  OSM_LOADER --> OSM_GRAPH

  OSM_GRAPH --> CROSS
  CROSS --> CROSSED_GRAPH

  CROSSED_GRAPH --> FOLD
  FOLD --> SEARCH_GRAPH

  SEARCH_GRAPH --> SPLIT
  SPLIT --> COST_CALC
  PARAMS -.-> COST_CALC
  COST_CALC --> PATH_FINDER

  SEARCH_GRAPH -.-> PATH_FINDER

  PLACE_DB --> NAME_RESOLVER
  NAME_RESOLVER --> LOCATION_MAP
  LOCATION_MAP --> NAVI_APP

  PATH_FINDER --> NAVI_APP
  PARAMS -.-> NAVI_APP
  NAVI_APP --> MAP
  NAVI_APP --> DEBUG
  SEARCH_BOX --> NAVI_APP
```

## データ変換の対応表

| 段階 | 入力 | 処理 | 出力 |
|------|------|------|------|
| 1 | Overpass API (JSON) | `osm-loader.js` (overpass-ql-ts) | `OSMGraph { MapNode, OSMEdge }` |
| 2 | `OSMGraph` | `extractIntersections` | `CrossedGraph { MapNode+crossNode, OSMEdge }` |
| 3 | `CrossedGraph` | `foldDegree2Edges` | `SearchGraph { MapVCrossNode, FoldedEdge, ComputedEdge }` |
| 4 | `SearchGraph` | Transient Split | セッション用グラフ (分割エッジ) |
| 5 | セッション用グラフ | `cost-calculator.js` | score 付きエッジ |
| 6 | score 付きエッジ | `path-finder.js` (Dijkstra) | 経路 (NodeId 列) |
| 7 | NodeId 列 | `navi-app.js` | Leaflet polyline |

## ファイル対応

| ファイル | 責務 |
|----------|------|
| `osm-loader.js` | Overpass API 呼び出し → OSMGraph |
| `fold_degree2.js` (統合予定) | 次数2 畳み込み |
| `cross_transform.js` → `search_graph.js` | 交差点抽出 |
| `cost-calculator.js` | スコアリング |
| `path-finder.js` | Dijkstra 実行 |
| `name_resolver.js` | 名前→座標 |
| `navi-app.js` | Svelte UI 統合 |
| `raw_node.js` | デバッグ用生ノード表示 |
