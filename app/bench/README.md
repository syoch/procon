# bench

経路探索 1 回にかかる時間を、測定項目ごとに測るためのハーネス。

## なぜ必要か

本番の `RequestContext`（`src/lib/requestContext.ts`）は `requireOSMData` だけを計測している。
グラフ構築（`CrossConvert` / `fold2DegreeEdges`）、経路探索（`pathFind`）、
急カーブ判定は**どこにも計測が入っていない**。実際測ると 1 検索の CPU の
**約 88% が可視化されていない**。

このハーネスはその穴を埋める。
CI では計算量の変化のような回帰も検出する。

## 使い方

```bash
cd app

# 実測回数と暖機回数は必須。CI と同じ値を渡すと CI の結果を再現できる
export OSM_CACHE_DIR=/tmp/procon-osm-cache
node bench/build.mjs                                   # 先にバンドルする
node bench/.build/fetch-fixture.mjs                    # 長岡市中心の実データを取りに行く（2 秒程度）
node bench/.build/bench.mjs --iterations 20 --warmup 5 # 全シナリオを全モードで測る
node bench/.build/bench.mjs --iterations 20 --warmup 5 --scenario pipeline
node bench/.build/bench.mjs --iterations 20 --warmup 5 --json /tmp/out.json --quiet
node bench/.build/bench.mjs --help

pnpm bench -- --iterations 20 --warmup 5   # バンドルと実行をまとめて行う

# 2 つの結果を比べる（CI が内部で実行しているもの）
node bench/compare.mjs --base base.json --head head.json [--tolerance 1.5] [--format markdown]
# 校正（機械の速度の比較）の許容を緩くする
node bench/compare.mjs --base base.json --head head.json --calibration-tolerance 0.2
# 同じコードを N 回走らせて、測定項目と校正のばらつきを採取する
node bench/build.mjs   # 先にバンドルする
node bench/scripts/measure-noise.mjs --iterations 20 --warmup 5 --runs 9
```

`pnpm bench` と `node bench/.build/bench.mjs` は `bench/build.mjs` で esbuild バンドルしてから
node で実行する。アプリと同じ TypeScript ソースを `$lib` などのエイリアス付きで import する
必要があるため、Vite / SvelteKit は通さない。

実測回数と暖機回数には既定値が無いので、測るたびに指定する。
値が決まっているのは [`deploy.yml`](../../.github/workflows/deploy.yml) の
`BENCH_ITERATIONS` / `BENCH_WARMUP` の 2 つだけで、base と head に同じ値を渡す。

## シナリオ

| シナリオ | 測るもの | 実行される頻度 |
|---|---|---|
| `pipeline` | データ層 → グラフ構築 → 経路探索 → 急カーブの 1 検索の CPU 内訳（全モード） | 検索のたび |
| `split` | `SplitOSMData` 単体 | キャッシュ保存時のみ（新規セル / TTL 失効） |
| `cache-read` | ファイルキャッシュが全ヒットした状態での `requireOSMData` | 検索のたび |

`pipeline` は全モード（`walk` / `bicycle` / `car` / `motorcycle` / `truck`）を測る。
モードでグラフの大きさも経路も変わるので（開発機の実測で `searchGraphEdges` が
11143〜16158 まで変わる）、モードごとに別々の測定項目として持つ。

`cache-read` からは本番の `RequestContext` と同じ段（`RequestContext.*`）も採れる。
ここが本番のログに出る値なので、実装のログと突き合わせられる。

`pipeline` は GSI の幅員データ（`requireGsiRoadSegmentsForTiles`）を含まない。
ネットワーク依存のためで、本番では幅員で経路が変わると `MAX_GSI_PASSES` 回グラフを作り直すので
`CrossConvert` と `fold2DegreeEdges` の測定項目は 1 パスあたりの値、
**実際はその回数倍**になる点に注意。

## 測定項目 ID

**測定項目は ID で突き合わせる。**
ID はモードを使うシナリオでは `{シナリオ}/{モード}/{段}`、使わないシナリオでは `{シナリオ}/{段}` になる。
`run.ts` の `stageId()` が組み立てる。

段の名前は文字列で、型では絞らない。
段の名前を変えると ID が変わるので、base と head で共通する項目が減る（削除 + 追加）。
したがって typo は差分に出たときに読む。
モードを使うシナリオはモードごとに 1 個作る（`pipelineScenario(mode)`）ので、
モードの判定は上流側に要らない。

| 記法 | 用途 |
|---|---|
| `recorder.mark("段")` | 1 パスの中の区切りを測る（`pipeline`） |
| `recorder.measure("段", setup, fn)` | 段だけの処理を暖機込みで繰り返し測る（`split` / `cache-read`） |
| `recorder.record("段", samples)` | 実行時に段が確定する測定項目に、生のサンプルを積む（`cache-read` の `RequestContext.*`） |

`RequestContext` の計測名は実行時に文字列で届くので、そのまま段の名前にする。
本番側に計測が追加されると、段が 1 つ増える。

### ID に入れるもの

ID には**上流から渡えず、リビジョンによって変動しうる値だけ**を入れる。

| 値 | 扱い |
|---|---|
| `{シナリオ}` | ID の 1 番目の成分 |
| `{モード}` | モードを使うシナリオの ID の 2 番目の成分 |
| `{段}` | ID の最後の成分 |
| `iterations` / `warmup` | CLI で渡す。CI は 1 箇所の値を base と head に渡す |
| `node` | `node-version: 26` で CI が固定 |
| データ規模（ノード数・辺数・経路長） | 同じ bbox の OSM キャッシュが保証する |

したがって ID が完全一致する項目どうしは同じ測定対象を指し、比べるのは `median` の比だけになる。
ID をリネームすると **削除 + 追加** になり、比較されない。
モードの値を変えると ID が変わるので、そのモードだけ比較されなくなる。

## 出力の読み方

- **中央値**を採用する。共有ランナー（GitHub Actions など）の CPU は一定ではないので、
  最小値や 1 回だけの値では判断できない。
- 必ず**暖機**する（回数は `--warmup` で渡す）。
  暖機を入れないと JIT の最適化前の回が中央値に混ざる。
- `min` と `max` の差が大きい段は、まだ最適化されていないか GC の影響を受ける。
  そのときは `node --cpu-prof` で hot 関数を特定する。
- 計測中の console 出力は要約される。`transientSplit` はフィクスチャ内の長さゼロの
  way ごとに「エッジの長さがゼロです」を出すので、回数だけまとめて出る。
- 最初に出る行は `fixture: ...` / `node: ...` / `calibration: ...` で、
  `calibration:` は段の結果ではなく**機械そのもの**の速度を測った値になっている。
  シナリオを走らせる前の状態なので、シナリオのログと混ざらない。
  シナリオ 1 個ごとに `calibration [<シナリオ名> の直前]` が 1 行ずつ出る。
  比較の判断をするときは先にここを読む（[校正ゲート](#校正ゲート機械の速度が変わっていないかの確認)）。

## 回帰チェック: base と head を 2 回測る

CI が **base のコードと head のコードを同じランナー上で 2 回測って比べる**。

同じランナー上の 2 つの値なら、差分はそのまま PR の変更の話になる。
ランナーが変わると値が混ざる、中間基準ファイルは PR 同士でコンフリクトする、
という 2 つの理由から、基準ファイルは持たない。

### CI がやること

1. `actions/checkout` を 2 回使って `base/` と `head/` を作る
2. `base` を計測して `bench-base.json`、`head` を計測して `bench-head.json`
3. `compare.mjs` で測定項目 ID ごとに比較。許容倍率（既定 1.5 倍）を超えた項目があれば exit 1

`base` は**自分の bench で自分の `app/src` をビルドする**。

比較は測定項目 ID 単位で行うので、base の bench が head の bench と違っても
同じ ID の測定項目同士は比較できる。
ただし両側が測定項目 ID を持つことが前提で、
base を測定した bench が `measurements` を持たない場合は比較不成立になる。

```
App@base    <-> bench/Measure@base   ->  bench 結果 ---+
                「同一でなくても良い」                  +-> 比較@HEAD -> CI の可否 / Summary
App@HEAD   <-> bench/Measure@HEAD   ->  bench 結果 ---+
```

これで `app/src` のモジュール移動が自由になる。移動すると bench の import パスも追随して
bench の内容が変わるが、測定項目が同じなら比較はそのまま成立する。

### ジョブの結論は 3 状態

`compare.mjs` の終了コードだけで決まる。

| 終了コード | ジョブ | 注記 |
|---|---|---|
| 0（回帰なし） | 緑 | — |
| 1（回帰あり） | 赤 | `::error::` |
| 1（契約違反） | 赤 | `::error::`。結果 JSON がスキーマを守らない |
| 2（比較不成立） | 緑 | `::warning::`。理由を job summary の先頭に出す |

比較不成立は「校正（機械の速度）が外れた」「測定項目 ID が一致しない」「結果 JSON の版が違う」の 3 つで、
いずれも性能の悪化ではない。
`base` に bench が無いときと `base` の計測が失敗したときも、比較不成立と同じく緑 + 警告で、
理由を job summary の先頭に出す。
判定は 1 ジョブの中で完結させる。

### 追加と削除

base に無い ID は「追加」、head に無い ID は「削除」として `compare.mjs` が明示する。
どちらも「測定対象が変わった」ことを意味するので、回帰判定には入らない。

追加は「測り始めた」、削除は「もう測っていない」（条件が変わったので ID を変えた）ことを表す。
どちらの ID も一致する項目は通常どおり比率で比較する。

### 結果 JSON のスキーマ

`lib/report.ts` が型とランタイム検証を持っている。作る側（`run.ts`）と
取り出す側（`compare.mjs`）が同じ型を使う。

| キー | 中身 |
|---|---|
| `schemaVersion` | 結果 JSON の版。今は `1` |
| `measurements` | 測定項目 ID -> 測定値（`median` / `min` / `max` / `iterations` / `total`） |
| `calibration` | 開始時の校正（測定値 + 仕事量の検算値 `work`） |
| `scenarioCalibration` | シナリオ名 -> そのシナリオを走らせる直前の校正 |
| `results` | シナリオごとの補足（データ規模・合計時間）。比較には使わない |

`measurements` の各キーがそのまま測定項目 ID になる。
ID の形は bench 側の約束なので、`lib/report.ts` は検証しない。
ID の集合が base と head で違う場合は「追加」「削除」として `compare.mjs` が明示する。

検証に失敗したときの扱いは 2 通りに分かれる。

- `schemaVersion` が違う = 測定項目 ID を持つ出力ではない。比較不成立として exit 2
- 版が同じで構造が契約を守らない = 契約違反。exit 1（緑にしない）

校正（`calibration` / `scenarioCalibration`）は測定項目 ID を持たない。
アプリに依存しない固定仕事量の 1 項工作なので、ID の比較とは別の判定になる。
校正の `work` は「同じ仕事をした」ことを確かめる検算値で、測定項目の値とは別の意味を持つ。

### 校正ゲート（機械の速度が変わっていないかの確認）

2 回測る前提は「その 2 回の間にランナーの状態が変わらない」ことだが、共有ランナーの
負荷は不安定なので、この前提は簡単に崩れる。

そこで `lib/reference.ts` に**アプリのコードに依存しない、固定仕事量の整数演算**を 1 つ用意し、
base と head の計測の直前に 1 回ずつ測る。使う仕事量は常に同じなので、所要時間だけが
機械の速度を反映する。`compare.mjs` はこの 2 つの比が `1 ± 0.10`
（`--calibration-tolerance` で変更できる）の外に出た場合、exit 2 にして
**「性能が悪化した」とは報告しない**。測定項目の表はそのまま出すが、回帰の判定は出さない
（校正面が通っているときだけ出す）。
ジョブをもう一度動かせば解決する、という扱いにする。

### シナリオ直前の校正

**開始時の校正 1 回では「計測の途中でランナーが遅くなった」ことを語れない。**
1 回の job は 1 分近く動くので、序盤が静かでも終盤になって突然遅くなることがある。

そのため校正は**各シナリオの直前にも測る**（出力では `calibration [pipeline の直前]` と出て、
JSON では `scenarioCalibration` にシナリオ名で入る）。
`compare.mjs` は base と head の「シナリオ N の直前」を 1 シナリオずつ突き合わせ、
ずれたシナリオの名前を含む警告を出して exit 2 にする。判定の閾値は開始時の校正と同じ
`--calibration-tolerance` で、`--tolerance` とは独立している。
両側に同じ ID の測定項目があるシナリオだけを見るので、追加または削除になった
シナリオの校正は比較しない。

このとき、**開始時の校正が一致していてシナリオ N だけずれていれば、
「序盤は正常で、計測の途中で遅くなった」と読める**ので、
警告を読むだけで、どのシナリオの計測が別々の状態で取られたかが分かる。

校正マップ（`scenarioCalibration`）は比較の前提なので、無ければ exit 2 にする。
校正は測定項目 ID を持たないので、校正の版と測定項目の版が同じである保証が無く、
マップの無い状態は「片方の校正が別の版で取られている」に読まれるため。

なお校正の絶対値は実行の途中で動く。1 つの job の開始時の校正だけを見ると、
この開発機では 72ms のまま 46ms まで落ちた（CPU の省電力状態から boost に移るため）。
同じランナー上の 2 つの job は同じ順序で走るので、この変化は比として相殺される。
したがって見るのは絶対値ではなく、同じシナリオの直前の比だけである。

### 仕事量の検算値（`work`）

校正の戻り値には `work` が入っている。校正は決定的なので、同じ Node で走らせれば
**必ず同じ値**（`-1202452748`）になる。時間が何倍であってもこの値が一致することを
別に判定する。
検出できる失敗が違うため。

- `median` がずれる = 機械の**速さ**が変わった（ランナーの負荷、スロットリング）
- `work` がずれる = 同じ**仕事**をした保証が壊れた（Node の版、bench の版、
  校正ワークロードの中身が違う）

`work` が一致しないときは、校正の `median` が完全に一致していても exit 2 にする。
校正も測定項目も「同じ仕事をした」ことが前提になる。
その前提が崩れるので、比べる意味がない。

### 校正が外れているときの回帰の扱い

**回帰の判定は不成立より先に行う。**
校正が外れていても許容倍率を超えていれば exit 1（赤）にして、回帰として報告する。

偽陽性になる可能性は残るが、緑にすると回帰検出を黙って止めることになる。
検証されていない緑は、検証されていない結論より悪い。
見出しには「校正が外れているため、機械の状態が信用できない」ことを添える。

校正が外れていて**回帰が無い**ときは exit 2（緑 + 警告）で、
見出しに「比較が成立しないため、回帰の判定は出していません」と書く。

`compare.mjs` は exit 2 のとき、理由を `bench-compare: <理由>: <説明>` の 1 行で stderr に出す。
CI はその 1 行で注記の等級を切り替える。

| 理由 | 意味 | 注記 |
| --- | --- | --- |
| `contract` | base か head の出力が測定項目 ID を持たない（出力契約の過渡期） | `::notice::` |
| `ids` | 両側に共通する測定項目 ID が無い | `::warning::` |
| `work` | 校正の `work` が一致しない（同じ仕事をした保証が壊れている） | `::warning::` |
| `machine` | 校正（機械の速度）が外れている | `::warning::` |

`contract` は「bench の出力契約を変えた PR」でしか出ない。
その PR を merge したあとは両側とも新しい契約になるので、注記（`::notice::`）にして区別する。

**基準ファイルを持たない設計が拾えないもの**:

基準ファイルを持たない設計は**ランナー間の差を吸収する**ので、
同じジョブの中の 2 回の差しか扱えない。
ランナー自身の変動（スロットリング）は校正ゲートが検出する。
両者は別々の問題に対する別の解なので、互いに代用できない。

校正の判定は測定項目ごとの判定（`--min-ms` のノイズ床、`--tolerance` の許容倍率）とは独立している。
校正は 1 項目だけの話ではなく「項目の集合全体」の話なので、どの項目が何倍でも同じ判定になる。
開始時の校正・シナリオ直前の校正・`work` の 3 つも同じ枠で、独立に判定される。

### 許容倍率

1.5 のまま緩めにしている。検出したいのは `SplitOSMData` の O(E×C) から O(E) へみたいな
**アルゴリズム単位**の変化（数倍）であって、数値が 1.2 倍動いた程度ではない。
同じランナー・同じフィクスチャで 2 回測すると machine 間の差は小さく、同じコードを 2 回
計測したときの項目の比率は 0.87〜1.07 倍に収まる（開発機での実測）。1.2 倍は測定ノイズの
範囲だが 1.5 倍なら確実に検出できる。

ただしこの余裕は**ランナーの状態が変わらない前提**の上に立っている。前提が崩れたときの
扱い（偽の回帰を出さない）は[校正ゲート](#校正ゲート機械の速度が変わっていないかの確認)が
担当する。
`BENCH_TOLERANCE` リポジトリ変数で変更できる。

### ノイズの採取（`scripts/measure-noise.mjs`）

上の 2 つの許容値は「同じコードを 2 回測るとどれくらい動くか」という測定に根拠を
置いている。採取はこのスクリプトで、**校正と測定項目を N 回分まとめて採取して
ばらつきを数値で見せる**。

```bash
cd app
node bench/build.mjs
node bench/scripts/measure-noise.mjs --iterations 20 --warmup 5 --runs 9   # 9 回分のばらつきを採取する
node bench/scripts/measure-noise.mjs --iterations 20 --warmup 5 --scenario split --runs 5
node bench/scripts/measure-noise.mjs --iterations 20 --warmup 5 --runs 9 --json /tmp/noise.json
```

出るのは「先頭回に対する比」「連続する回どうしの比」「採取中のどの 2 回でも選んだときの
上限（最悪の組）」と、許容を超えた組の数。CI が比較するのは「続けて走らせた 2 回」なので、
判断に使うのは**連続比**の列である。

**2026-10-02 の開発機（Ryzen 5 5625U / Node 26.10.0）での実測（9 回）**:

| 指標 | 値 |
|---|---|
| 校正の連続比 | 0.81x - 1.19x（32 組） |
| うち負荷の変動が無いときの連続比 | 0.98x - 1.05x（5 組） |
| 判定対象の測定項目の連続比 | 0.83x - 1.28x（128 組） |
| 1.5x を超えた測定項目 | 0 組 |
| 採取中のドリフト（開始時の校正の最大/最小） | 1.23x |

このうち 1.19x と 0.81x は 2 回連続で他の job が重なったときの往復で、校正は
それを両方捕まえている。静かなときの連続比は 0.98x〜1.05x に収まるので、
**校正の許容 ±0.10 は「静かなときの 2 倍」「実際に捕まえたい 1.2 倍の 6 割」という位置**にあり、
0.05 まで下げると静かなときの 0.98x でも exit 2 になり、0.20 まで上げると 1.19x の
往復を素通りする。
**既定の 0.10 は妥当**なので、既定値は変えない。
ただしこれは開発機の数字であり、GitHub の共有ランナーはこれより悪い可能性がある。
ランナー上の数字が必要なときは、CI が 30 日間保存する `bench-base.json` と
`bench-head.json` のアーティファクトから校正の比を直接求めてよい。

### ノイズ床（`--min-ms`）

**0.5ms 未満の測定項目は回帰判定の対象外**にする（表では `*` が付く）。
0.02ms の項目が 0.04ms になっても、それは測定解像度の問題であって性能の回帰ではない。
この判定がないと、`divideBoundary` が毎回 2 倍速度で PR が落ち続ける。

`*` が付かない測定項目だけが判定対象。
表を読むときはこの点に注意。

## フィクスチャ

フィクスチャは**本番の OSM キャッシュと同じディレクトリ**を直接読む。
`OSM_CACHE_DIR` にセルファイル一式が入っていれば、それがフィクスチャになる。

```
OSM_CACHE_DIR/
└── {minLat}-{minLng}-{maxLat}-{maxLng}.json
```

セルファイル名が領域を表し、規模もセルから数えられるので manifest は置かない。
セルファイル名は `fs-cache-manager` の `encodeFilename` と同じ形式にする。
`cache-read` シナリオはこのセルを実際に `readCache` するため、
ファイル名と中身の形式を変えると壊れる。

### 取得する

`scripts/fetch-fixture.ts` が `requireOSMData` を通すので、
セルの分割・問い合わせ・保存はすべて本番と同じ経路になる。
取得済みのセルは `readCache` が飛ばし、残りを `simplifyBoundaries` で 1 クエリにまとめるので、
1 回の実行で投げるクエリは 1 本だけになる。

公開 Overpass は混雑すると 504 を返すので、失敗したときは全体を取り直す。
取り直しは 3 回までで、取得済みのセルはキャッシュに残っているため 2 回目以降のクエリは減る。
全セルが揃っていれば何もせず終わる（no-op）。

```bash
cd app
node bench/build.mjs
OSM_CACHE_DIR=/tmp/procon-osm-cache node bench/.build/fetch-fixture.mjs
```

取得する領域は長岡市中心（bbox はセル境界にスナップした固定値）で、セルは 8 個。
`OVERPASS_ENDPOINT` を指定すると公開 Overpass 以外を使える。

### CI での扱い

`deploy.yml` は `actions/cache` で `OSM_CACHE_DIR` を復元してから `fetch-fixture.mjs` を実行し、
キャッシュがヒットしなかったときだけ保存する。
キャッシュ key は固定なので、取得した OSM データはそのまま使い回される。
`base` と `head` は同じ復元キャッシュを見るので、比較する 2 つの計測は同一のグラフになる。

キャッシュが退避されて取り直すときだけ、その時点の OSM データになって全測定項目がずれる。
それはグラフが変わった差なので、検出できる差のうちの 1 つとして扱う。
取得時刻はセルファイルの更新日時から分かるので、bench の 1 行目に `fetchedAt` として出る。

## ディレクトリ

```
bench/
├── README.md
├── build.mjs                      # esbuild でバンドルする
├── compare.mjs                    # 2 つの結果を ID で突き合わせる（回帰チェック）
├── env-stub.ts                    # $env/dynamic/private の差し替え
├── run.ts                         # エントリ。引数解析・出力・回帰チェック
├── lib/
│   ├── data.ts                    # フィクスチャ読み込み・始点終点の決定
│   ├── harness.ts                 # 暖機・反復・中央値集計と StageRecorder
│   ├── reference.ts               # 校正（固定仕事量の整数演算）
│   └── report.ts                  # 結果 JSON のスキーマ（型と検証）
├── scenarios/
│   ├── types.ts                   # Scenario と ScenarioResult の型
│   ├── pipeline.ts                # 1 検索の CPU 内訳
│   ├── split.ts                   # SplitOSMData 単体
│   └── cache-read.ts              # requireOSMData（キャッシュ全ヒット）
└── scripts/
    ├── fetch-fixture.ts           # OSM_CACHE_DIR にフィクスチャを用意する
    └── measure-noise.mjs          # 同じコードを N 回測ってばらつきを採取する
```

## 正しさの検証について

このハーネスは**時間を測るだけ**で、出力の正しさは検証しない。
`SplitOSMData` の重複やセル取りこぼしの検証は
`app/tests/osm-cache/split-osm-data.test.ts` の責務なので、そちらに回帰テストを書くこと。

`pipeline` の `pathLength`（情報）が 0 になったら測定が成立していない
（始点・終点が道から離れ、`transientSplit` が空振りしている）。
`lib/data.ts` の `pickEndpointsOnMainComponent` を見直すこと。
