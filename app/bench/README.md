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
# 校正（機械の速度の比較）の許容を緩くする
node bench/compare.mjs --base base.json --head head.json --calibration-tolerance 0.2
# 比較不成立（exit 2）でも回帰リストを「参考値」として出す
node bench/compare.mjs --base base.json --head head.json --report-on-invalid

# 同じコードを N 回走らせて、段と校正のばらつきを採取する
node bench/build.mjs   # 先にバンドルする
node bench/scripts/measure-noise.mjs --runs 9
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
- 最初に出る行は `fixture: ...` / `node: ...` / `calibration: ...` で、
  `calibration:` は段の結果ではなく**機械そのもの**の速度を測った値になっている。
  シナリオを走らせる前の状態なので、シナリオのログと混ざらない。
  シナリオ 1 個ごとに `calibration [<シナリオ名> の直前]` が 1 行ずつ出る。
  比較の判断をするときは先にここを読む（[校正ゲート](#校正ゲート機械の速度が変わっていないかの確認)）。

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
2. `base/app/bench` と `head/app/bench` が同一かを確認する
   （`diff -rq -x .build`）。異なる場合は比較しない
3. `base` を計測して `bench-base.json`、`head` を計測して `bench-head.json`
4. `compare.mjs` で比較。許容倍率（既定 1.5 倍）を超えた段があれば exit 1

2 の確認をしているのは、**base は自分の bench を自分の `app/src` に対してビルドする**ため。
bench を head から複製すると、bench が import する `../../src/...` のパスが
base 側に持ち越され、ソースを移動しただけの PR で base のビルドが失敗する。

比較の前提が崩れている場合は exit 2 で区別する。フィクスチャや Node のバージョンが
違う、`searchGraphEdges` などデータ規模が変わっている場合がこれに当たる。
このときは「性能が悪くなった」ではなく「比較できない」として扱う。

`base` のビルドが失敗するケース（PR がソースを移動または改名した等）は比較を諦めて、
`head` の値だけ提示して成功にする（`continue-on-error`）。

### 校正ゲート（機械の速度が変わっていないかの確認）

2 回測る前提は「その 2 回の間にランナーの状態が変わらない」ことだが、共有ランナーの
負荷は不安定なので、この前提は簡単に崩れる。

そこで `lib/reference.ts` に**アプリのコードに依存しない、固定仕事量の整数演算**を 1 つ用意し、
base と head の計測の直前に 1 回ずつ測る。使う仕事量は常に同じなので、所要時間だけが
機械の速度を反映する。`compare.mjs` はこの 2 つの比が `1 ± 0.10`
（`--calibration-tolerance` で変更できる）の外に出た場合、exit 2 にして
**「性能が悪化した」とは報告しない**。段の表はそのまま出すが、回帰の判定は出さない
（校正面が通っているときだけ出す）。ジョブをもう一度動かせば解決する、という扱いにする。

### シナリオ直前の校正

**開始時の校正 1 回では「計測の途中でランナーが遅くなった」ことを語れない。**
1 回の job は 1 分近く動くので、序盤が静かでも終盤になって突然遅くなることがある。

そのため校正は**各シナリオの直前にも測る**（出力では `calibration [pipeline の直前]` と出て、
JSON では `scenarioCalibration` にシナリオ名で入る）。
`compare.mjs` は base と head の「シナリオ N の直前」を 1 シナリオずつ突き合わせ、
ずれたシナリオの名前を含む警告を出して exit 2 にする。判定の閾値は開始時の校正と同じ
`--calibration-tolerance` で、`--tolerance` とは独立している。

このとき、**開始時の校正が一致していてシナリオ N だけずれていれば、
「序盤は正常で、計測の途中で遅くなった」と読める**ので、
警告を読むだけで、どのシナリオの計測が別々の状態で取られたかが分かる。

校正マップ（`scenarioCalibration`）が無い JSON を渡すと、この検査は exit 2 になる。
比較する 2 つの JSON は同じ版の bench で取るのが前提なので、
これは「片方だけ古い bench で取っている」という状態を検出しているだけである。
CI は `base/app/bench` に `head/app/bench` を丸ごと上書きするので、両方の JSON は同じ版になる。

なお校正の絶対値は実行の途中で動く。1 つの job の開始時の校正だけを見ると、
この開発機では 72ms のまま 46ms まで落ちた（CPU の省電力状態から boost に移るため）。
同じランナー上の 2 つの job は同じ順序で走るので、この変化は比として相殺される。
したがって見るのは絶対値ではなく、同じシナリオの直前の比だけである。

### 仕事量の検算値（`work`）

校正の戻り値には `work` が入っている。校正は決定的なので、同じ Node で走らせれば
**必ず同じ値**（`-1202452748`）になる。時間が何倍であってもこの値が一致することを
別に判定している。検出できる失敗が違うため。

- `median` がずれる = 機械の**速さ**が変わった（ランナーの負荷、スロットリング）
- `work` がずれる = 同じ**仕事**をした保証が壊れた（Node の版、bench の版、
  校正ワークロードの中身が違う）

`work` が一致しないときは、校正の `median` が完全に一致していても exit 2 にする。
校正も段も「同じ仕事をした」ことが前提になる。その前提が崩れるので、比べる意味がない。

### 参考値としての回帰レポート（`--report-on-invalid`）

校正が通らないと、回帰レポートが 1 行も出ない。比較不成立を「報告する価値がない」に
そのまま変えてしまうため、本物の回帰も一緒に隠れてしまう。

そこで `--report-on-invalid` を付けると、**exit 2 を保ったまま**
「性能回帰の参考値（機械の状態が信用できないため判定ではない）」として回帰リストを出す。
CI はこのフラグを付けるので、失敗した PR でも「本当に遅くなった段があったか」が読める。
判定（exit code）は 2 のままなので、比較不成立という結論は変わらない。既定では従来どおり出さない。

**なぜ基準ファイルを git に入れないのにこのゲートが要るか**:
このゲートは値を保存しないので、基準ファイルを置いた場合の 3 つの難所
（ランナーごとの値が混ざる / PR 同士で基準が衝突する / レビュアが差分を判断できない）
のどれにもあたらない。扱うのは「同じジョブの中で 2 回測った値どうし」だけなので、
保存する値も比べる相手も要らない。基準ファイルを持たない設計は
**ランナー間の差を吸収できるが、ランナー自身の変動は検出できない**ので、
このゲートを足して穴を塞いでいる。両者は別々の問題に対する別の解で、互いに代用できない。

校正の判定は段ごとの判定（`--min-ms` のノイズ床、`--tolerance` の許容倍率）とは独立している。
校正は 1 段だけの話ではなく「段の集合全体」の話なので、どの段が何倍でも同じ判定になる。
開始時の校正・シナリオ直前の校正・`work` の 3 つも同じ枠で、独立に判定される。

### 許容倍率

1.5 のまま緩めにしている。検出したいのは `SplitOSMData` の O(E×C) から O(E) へみたいな
**アルゴリズム単位**の変化（数倍）であって、数値が 1.2 倍動いた程度ではない。
同じランナー・同じフィクスチャで 2 回測ると machine 間の差は小さく、同じコードを 2 回
計測したときの段の比率は 0.87〜1.07 倍に収まる（開発機での実測）。1.2 倍は測定ノイズの
範囲だが 1.5 倍なら確実に検出できる。

ただしこの余裕は**ランナーの状態が変わらない前提**の上に立っている。前提が崩れたときの
扱い（偽の回帰を出さない）は[校正ゲート](#校正ゲート機械の速度が変わっていないかの確認)が
担当している。`BENCH_TOLERANCE` リポジトリ変数で変更できる。

### ノイズの採取（`scripts/measure-noise.mjs`）

上の 2 つの許容値は「同じコードを 2 回測るとどれくらい動くか」という測定に根拠を
置いている。採取はこのスクリプトで、**校正と段を N 回分まとめて採取して
ばらつきを数値で見せる**。

```bash
cd app
node bench/build.mjs
node bench/scripts/measure-noise.mjs --runs 9          # 9 回分のばらつきを採取する
node bench/scripts/measure-noise.mjs --scenario split --runs 5   # 速い組み合わせで試す
node bench/scripts/measure-noise.mjs --runs 9 --json /tmp/noise.json  # 生データも保存
```

出るのは「先頭回に対する比」「連続する回どうしの比」「採取中のどの 2 回でも選んだときの
上限（最悪の組）」と、許容を超えた組の数。CI が比較するのは「続けて走らせた 2 回」なので、
判断に使うのは**連続比**の列である。

**2026-10-02 の開発機（Ryzen 5 5625U / Node 26.10.0）での実測（9 回）**:

| 指標 | 値 |
|---|---|
| 校正の連続比 | 0.81x - 1.19x（32 組） |
| うち負荷の変動が無いときの連続比 | 0.98x - 1.05x（5 組） |
| 判定対象の段の連続比 | 0.83x - 1.28x（128 組） |
| 1.5x を超えた段 | 0 組 |
| 採取中のドリフト（開始時の校正の最大/最小） | 1.23x |

このうち 1.19x と 0.81x は 2 回連続で他の job が重なったときの往復で、校正は
それを両方捕まえている。静かなときの連続比は 0.98x〜1.05x に収まるので、
**校正の許容 ±0.10 は「静かなときの 2 倍」「実際に捕まえたい 1.2 倍の 6 割」という位置**にあり、
0.05 まで下げると静かなときの 0.98x でも exit 2 になり、0.20 まで上げると 1.19x の
往復を素通りする。**既定の 0.10 は妥当**で、既定値は変えない。
ただしこれは開発機の数字であり、GitHub の共有ランナーはこれより悪い可能性がある。
ランナー上の数字が必要なときは、CI が 30 日間保存する `bench-base.json` と
`bench-head.json` のアーティファクトから校正の比を直接求めてよい。

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
├── compare-modes.ts               # エントリ。5 モードの経路差を比べる（時間は測らない）
├── compare.mjs                    # 2 つの結果を比べる（回帰チェック）
├── env-stub.ts                    # $env/dynamic/private の差し替え
├── run.ts                         # エントリ。引数解析・出力・回帰チェック
├── fixtures/
│   └── nagaoka-central.json.gz    # 長岡市中心の実データ（gzip、244KB）
├── lib/
│   ├── data.ts                    # フィクスチャ読み込み・始点終点の決定
│   ├── harness.ts                 # 暖機・反復・中央値集計
│   └── reference.ts               # 校正（固定仕事量の整数演算）
├── scenarios/
│   ├── types.ts                   # Scenario 型と StageRecorder
│   ├── pipeline.ts                # 1 検索の CPU 内訳
│   ├── split.ts                   # SplitOSMData 単体
│   └── cache-read.ts              # requireOSMData（キャッシュ全ヒット）
└── scripts/
    └── measure-noise.mjs          # 同じコードを N 回測ってばらつきを採取する
```

## モードごとの経路差の比較

`compare-modes.ts` は時間の代わりに**経路の中身**をモードごとに比べる CLI である。
Issue #85（モードごとのスコアの見直し）の検証手段として作った。

```bash
cd app
pnpm bench:modes                                    # 既定の始点・終点で 5 モードを探索
pnpm bench:modes --begin 37.4448,138.8537 --end 37.4326,138.9042
pnpm bench:modes --modes walk,bicycle,truck         # 比較するモードを選ぶ
pnpm bench:modes --reference walk                   # 一致率の基準にするモード（既定 car）
pnpm bench:modes --no-gsi                           # 国土地理院の幅員を使わずに探索する
pnpm bench:modes --json /tmp/modes.json             # 経路が使う way id ごと保存する
```

`SCENARIOS` には含めない。
理由は 2 つある。

- 時間計測の回帰ゲートは base と head の**時間**を比べる。
  経路の差は時間ではないので、段として採ると比較の単位が時間ではなく経路の重なり方になる。
- 比較には 5 モードを**1 プロセスで**走らせる必要がある。
  `pnpm bench` の `--mode` は 1 回に 1 値を渡す形なので、`SCENARIOS` に置くと 5 回走らせた結果を手作業で突き合わせることになる。

測定項目 ID は出さない。
`{シナリオ}/{モード}/{段}` の規約は時間を採る段のためのもので、この CLI は段を持たない。

一致率は「経路が使う FoldedEdge（= OSM の way）の集合が、基準モードの経路と何割一致するか」。
way の id はモードをまたいで同じなのでこれで比べられる。
`MapVCrossEdge` は隣接ノードがそのモードのグラフに含まれるかどうかで id が変わるため数えない。

国土地理院の幅員は本番と同じく、始点・終点と経路の周りのタイルを順に足しながら
`MAX_GSI_PASSES` 回まで探索し直す。
取得したタイルは `bench/.build/gsi-cache/gsi/` に保存されるので、2 回目以降はネットワークに出ない。
このキャッシュは `.gitignore` 済みで、国土地理院が更新されたら差分は記録に含まれない。
数値を再現するときは、このディレクトリを保存して `--gsi-cache-dir` で渡す。

実測した数値と、その読み方は
[`docs/設計/04-スコアリングと経路探索.md`](../../docs/設計/04-スコアリングと経路探索.md)
の「モードごとのスコア」に書いてある。

## 正しさの検証について

このハーネスは**時間を測るだけ**で、出力の正しさは検証しない。
`SplitOSMData` の重複やセル取りこぼしの検証は
`app/tests/osm-cache/split-osm-data.test.ts` の責務なので、そちらに回帰テストを書くこと。

`pipeline` の `pathLength` が 0 になったら測定が成立していない
（始点・終点が道から離れ、`transientSplit` が空振りしている）。
`lib/data.ts` の `pickEndpointsOnMainComponent` を見直すこと。
