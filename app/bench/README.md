# bench

経路探索 1 回にかかる時間を、段ごとに測るためのハーネス。

## なぜ必要か

本番の `RequestContext`（`src/lib/requestContext.ts`）は `requireOSMData` だけを計測している。
グラフ構築（`CrossConvert` / `fold2DegreeEdges`）、経路探索（`pathFind`）、
急カーブ判定は**どこにも計測が入っていない**。実際測ると 1 検索の CPU の
**約 88% が可視化されていない**。

このハーネスはその穴を埋める。加えて、CI で計算量の変化のような回帰を検出する役割を担う。

## 使い方

```bash
cd app

pnpm bench                          # 全シナリオを既定回数で実行
pnpm bench -- --scenario pipeline   # シナリオを 1 つだけ
pnpm bench -- --iterations 30       # 実測回数を増やす（既定 20）
pnpm bench -- --mode bicycle        # 移動モードを変える
pnpm bench -- --json /tmp/out.json  # 結果を JSON で保存（比較スクリプトが読む）
pnpm bench -- --help

# 2 つの結果を比べる（CI が内部で実行しているもの）
node bench/compare.mjs --base base.json --head head.json [--tolerance 1.5] [--format markdown]
```

`pnpm bench` は `bench/build.mjs` で esbuild バンドルしてから node で実行する。
アプリと同じ TypeScript ソースを `$lib` などのエイリアス付きで import する必要があるため、
Vite / SvelteKit は通さない。

## シナリオ

| シナリオ | 測るもの | 実行される頻度 |
|---|---|---|
| `pipeline` | データ層 → グラフ構築 → 経路探索 → 急カーブの 1 検索の CPU 内訳 | 検索のたび |
| `split` | `SplitOSMData` 単体 | キャッシュ保存時のみ（新規セル / TTL 失効） |
| `cache-read` | ファイルキャッシュが全ヒットした状態での `requireOSMData` | 検索のたび |

`cache-read` からは本番の `RequestContext` と同じ段（`RequestContext.*`）も採れる。
ここが本番のログに出る値なので、実装のログと突き合わせられる。

`pipeline` は GSI の幅員データ（`requireGsiRoadSegmentsForTiles`）を含まない。
ネットワーク依存のためで、本番では幅員で経路が変わると `MAX_GSI_PASSES` 回グラフを作り直すので
`CrossConvert` と `fold2DegreeEdges` の段は 1 パスあたりの値、
**実際はその回数倍**になる点に注意。

## 出力の読み方

- **中央値**を採用する。共有ランナー（GitHub Actions など）の CPU は一定ではないので、
  最小値や 1 回だけの値では判断できない。
- 必ず**暖機**（既定 5 回）している。暖機を入れないと JIT の最適化前の回が中央値に混ざる。
- `min` と `max` の差が大きい段は、まだ最適化されていないか GC の影響を受ける。
  そのときは `node --cpu-prof` で hot 関数を特定する。
- 計測中の console 出力は要約される。`transientSplit` はフィクスチャ内の長さゼロの
  way ごとに「エッジの長さがゼロです」を出すので、回数だけまとめて出る。

## 回帰チェック: base と head を 2 回測る

**リポジトリに基準ファイルは置かない。** 代わりに CI が
**base のコードと head のコードを同じランナー上で 2 回測って比べる**。

基準ファイルを置くのを避けている理由:

- 基準ファイルの値は CPU も Node も違うランナーで取得されたものが混ざる。
  自分のマシンで見た値と大きくずれる。
- 2 つの PR が両方基準を更新するとコンフリクトする。
- レビュアは「3.0ms から 2.9ms が速くなったのか」を判断できない。
  同じ環境で測った 2 つの値なら、そのまま PR の変更の話になる。

### CI がやること

1. `actions/checkout` を 2 回使って `base/` と `head/` を作る
2. `base/app/bench` を `head/app/bench` で上書きする（ハーネスは両方で同一にする。
   測るのはアプリのソースだけなので、PR が bench を変えても比較が成立する）
3. `base` を計測して `bench-base.json`、`head` を計測して `bench-head.json`
4. `compare.mjs` で比較。許容倍率（既定 1.5 倍）を超えた段があれば exit 1

比較の前提が崩れている場合は exit 2 で区別する。フィクスチャや Node のバージョンが
違う、`searchGraphEdges` などデータ規模が変わっている場合がこれに当たる。
このときは「性能が悪くなった」ではなく「比較できない」として扱う。

`base` のビルドが失敗するケース（PR がソースを移動または改名した等）は比較を諦めて、
`head` の値だけ提示して成功にする（`continue-on-error`）。

### 許容倍率

1.5 のまま緩めにしている。検出したいのは `SplitOSMData` の O(E×C) から O(E) へみたいな
**アルゴリズム単位**の変化（数倍）であって、数値が 1.2 倍動いた程度ではない。
同じランナー・同じフィクスチャで 2 回測るので machine 間の差は小さく、
1.2 倍は測定ノイズの範囲だが 1.5 倍なら確実に検出できる。

`BENCH_TOLERANCE` リポジトリ変数で変更できる。

### ノイズ床（`--min-ms`）

**0.5ms 未満の段は回帰判定の対象外**にする（表では `*` が付く）。
0.02ms の段が 0.04ms になっても、それは測定解像度の問題であって性能の回帰ではない。
この判定がないと、`divideBoundary` が毎回 2 倍速度で PR が落ち続ける。

`*` が付かない段だけが判定対象。表を読むときはこの点に注意。

### 手元で再現する

```bash
# 変更前のコミットを一時ディレクトリに切り出して、そこに対して計測する
git worktree add /tmp/base HEAD~1
cp -r app/bench /tmp/base/app/bench

# head を測る
cd app
node bench/build.mjs
node bench/.build/bench.mjs --quiet --json /tmp/head.json

# base を測る
cd /tmp/base/app
node bench/build.mjs
node bench/.build/bench.mjs --quiet --json /tmp/base.json

# 比較する
cd -
node app/bench/compare.mjs --base /tmp/base.json --head /tmp/head.json --format markdown
```

## フィクスチャ

`fixtures/nagaoka-central.json.gz` は長岡市中心の実データ（Overpass API から 2026-10 取得）。
生データ 1.5MB を **gzip で 244KB** に圧縮し、1 ファイルにまとめている。
中身はセルファイル 8 枚ぶんの実データで、`fs-cache-manager` のファイル名形式
（`{minLat}-{minLng}-{maxLat}-{maxLng}.json`）のまま。`cache-read` シナリオは
このセルを実際に `readCache` するため、**ファイル名と中身の形式を変えると壊れる**。

gzip にしているのは、タグを削るより圧縮の方が効くため。
タグを除いても 1239KB とほとんど縮まない。ノードの緯度経度と way のノード ID 列が
本体の大部分を占めている。

### 差し替え

`BENCH_FIXTURE` 環境変数で場所を指定できる。`.json.gz` 内の構造は
`{ meta: {...}, cells: { "37.421875-138.84375-....json": { elements: [...] } } }`。

```bash
BENCH_FIXTURE=/path/to/other.json.gz pnpm bench
```

### `actions/cache` で git に入れない代替

`actions/cache` に OSM キャッシュを保存し、`BENCH_FIXTURE` で復元先のパスを渡せば、
git にデータを持たずに済む。`deploy.yml` は `BENCH_FIXTURE` を
`app/bench/fixtures/nagaoka-central.json.gz` に固定しているだけなので差し替えられる。

ただし**回帰ゲートの基準線としては推奨しない**。理由は 2 つ。

1. **基準線が意味を失う。** キャッシュが空の時（初回、あるいは 7 日以上
   アクセスがないと GitHub が退避させる）に Overpass から取り直すと、
   その時点の OSM データになる。実データが僅かに変わるだけで全部の段がずれるので、
   ベンチの厚みと無関係な差を区別できなくなる。
2. **PR の合流に外部依存が混ざる。** Overpass が遅くなったり落ちていただけで
   bench ジョブが落ちる。回帰検出という目的自体が成立しなくなる。

どちらも 244KB のファイルを 1 つ置けば解決する話なので、決定性を優先して git 管理を採った。
0 バイトにしたい場合はキャッシュ方式に変更できるが、上記 2 点を許容できることが前提になる。

## ディレクトリ

```
bench/
├── README.md
├── build.mjs                      # esbuild でバンドルする
├── compare.mjs                    # 2 つの結果を比べる（回帰チェック）
├── env-stub.ts                    # $env/dynamic/private の差し替え
├── run.ts                         # エントリ。引数解析・出力・回帰チェック
├── fixtures/
│   └── nagaoka-central.json.gz    # 長岡市中心の実データ（gzip、244KB）
├── lib/
│   ├── data.ts                    # フィクスチャ読み込み・始点終点の決定
│   └── harness.ts                 # 暖機・反復・中央値集計
└── scenarios/
    ├── types.ts                   # Scenario 型と StageRecorder
    ├── pipeline.ts                # 1 検索の CPU 内訳
    ├── split.ts                   # SplitOSMData 単体
    └── cache-read.ts              # requireOSMData（キャッシュ全ヒット）
```

## 正しさの検証について

このハーネスは**時間を測るだけ**で、出力の正しさは検証しない。
`SplitOSMData` の重複やセル取りこぼしの検証は
`app/tests/osm-cache/split-osm-data.test.ts` の責務なので、そちらに回帰テストを書くこと。

`pipeline` の `pathLength` が 0 になったら測定が成立していない
（始点・終点が道から離れ、`transientSplit` が空振りしている）。
`lib/data.ts` の `pickEndpointsOnMainComponent` を見直すこと。
