# README

<!-- ## アーキテクチャ -->

## コマンド

### パッケージの更新・インストール

```shell
[procon@vm20025:~]$ sudo apt update
[procon@vm20025:~]$ sudo apt upgrade
[procon@vm20025:~]$ sudo apt install -y certbot nginx git nix python3-certbot-nginx
```

### sudoers 更新

```shell
[procon@vm20025:~]$ echo 'procon ALL=(root) NOPASSWD: /usr/bin/nix' | sudo tee /etc/sudoers.d/procon-deploy
```

### 証明書の取得

```shell
[procon@vm20025:~]$ sudo certbot certonly --nginx -d procon.syoch.org
```

### procon.env の作成

本システムでは環境変数 `OSM_CACHE_DIR` を使うが、この環境変数は systemd service unit で定義されるため、 procon.env では定義しない。

```shell
[procon@vm20025:~]$ sudo tee /etc/procon.env <<EOF
OVERPASS_ENDPOINT=(overpass API のエンドポイント URL)
PROCON_CACHE_REFRESH_TOKEN=$(openssl rand -hex 32)
# OSM_CACHE_TTL_DAYS=30
EOF
```

### サーバーリポジトリのクローン

```shell
[procon@vm20025:~]$ sudo mkdir -p /srv/procon
[procon@vm20025:~]$ sudo chown procon:procon /srv/procon
[procon@vm20025:~]$ git clone git@github.com:syoch/procon.git /srv/procon
```

### デプロイ操作

```shell
[procon@vm20025:~]$ sudo nix --extra-experimental-features nix-command --extra-experimental-features flakes run /srv/procon#setup
```

### キャッシュ更新の手動実行

`procon-cache-refresh.timer` が OSM キャッシュの失効セルを毎日取り直す。
内部の動作は [`osm/README.md`](../app/src/lib/osm/README.md#定期更新) を参照。

```shell
[procon@vm20025:~]$ sudo systemctl start procon-cache-refresh.service
```

## 環境変数

### `OVERPASS_ENDPOINT` (必須)

Overpass API のエンドポイント

### `PROCON_CACHE_REFRESH_TOKEN` (必須)

キャッシュ更新エンドポイントの認証トークン。**未設定だと更新が全て拒否される**（`POST /api/cache-refresh` が 503 を返す）ため、`nix run .#setup` が警告を出す。引用符や空白を含まない値を入れる

### `OSM_CACHE_TTL_DAYS` (任意)

OSM キャッシュの有効期間（日数）。未設定なら 30 日、`0` で失効させない。解釈規則は [`osm/README.md`](../app/src/lib/osm/README.md#取得時刻と-ttl) を参照

### `PROCON_HEAD_HASH` (任意)

起動したビルドの git commit を持ち、トレース用 DB の `boots.head_hash` に記録する。
デプロイごとに「どのビルドのトレースか」を区別できるようにするための変数であり、未指定の場合は `no-git` として扱われる。

`setup-script` は Git リポジトリ `/srv/procon` を参照できる。
そのため、この変数は `setup-script` によって `git rev-parse HEAD` の値を用いて `/etc/procon-head-hash.env` を作成する。
HEAD ハッシュを取得できない場合は `no-git` として扱われる。

`procon-app.service` は `/etc/procon-head-hash.env` を `EnvironmentFile` で読み込む。

`procon-server.service` で起動されるサーバーは作業ツリーのコピーであるため、開発中などは Git リポジトリにコミットされていない変更がある場合がある。
このような場合、`HEAD` ハッシュに `-dirty` がつく。
これにより、実態がコミットと一致しないことを明示できる。

### `DATABASE_LOCATOR` (任意)

この変数は Tracing モジュールが使う SQLite データベースのパスを示すために使われる。
`:memory:` はインメモリで動作し、空文字列は Tracing モジュールを使わないことを意味する。

既存のデプロイにおいてこの変数を設定しなかった場合は、Tracing モジュールを無効化した状態でサービスは動作する。

## 自前 Overpass (任意)

デモを公開 Overpass に依存させないため、日本全体の OSM データを自前で持てる。
`procon-app` とは独立に動く。

### セットアップ

```shell
[procon@vm20025:~]$ sudo nix run /srv/procon#overpass-setup
[procon@vm20025:~]$ sudo nix run /srv/procon#overpass-init
```

`overpass-setup` は `overpass` ユーザ、DB ディレクトリ、3 つの systemd unit を用意する。
短く冪等であり、`procon-app` を再起動しない。
`setup` は `procon-app` を再起動するので流用しない。

`overpass-init` は extract を取得して DB を構築し、3 つの unit を起動する。
既定の extract は `japan-latest.osm.pbf` であり、`OVERPASS_PBF_URL` で差し替えられる。

### エンドポイント

`http://127.0.0.1:3001/api/interpreter` で待ち受ける。
`3000` は `procon-app` が使うため `3001` にしている。
`localhost` にだけ束縛するので外からは見えない。

アプリはセル単位で自前と外部ミラーを振り分ける（`osm-fetcher.ts`）。

| 環境変数 | 役割 |
|---|---|
| `OVERPASS_ENDPOINT` | 外部ミラー。**カバレッジの外のセルはここへ送る**。必須 |
| `OSM_SELF_HOSTED_ENDPOINT` | 自前。**未設定なら `OVERPASS_ENDPOINT` だけを使う**（後方互換） |
| `OSM_SELF_HOSTED_COVERAGE` | 自前が持つ範囲。`minLat,minLng,maxLat,maxLng` のカンマ区切り |

```
OVERPASS_ENDPOINT=https://overpass.openstreetmap.fr/api/interpreter
OSM_SELF_HOSTED_ENDPOINT=http://127.0.0.1:3001/api/interpreter
OSM_SELF_HOSTED_COVERAGE=23.984375,122.875,45.625,154.015625
```

**`OVERPASS_ENDPOINT` を自前へ書き換えない。** 書き換えると自前が唯一の取得元になり、
DB の外のセルで空が返り、その空がキャッシュに書かれる。

振り分けは**座標**で決める。
**空の応答では判定しない。**

| セル | 送り先 | キャッシュ |
|---|---|---|
| 完全にカバレッジ内 | 自前 | しない |
| 完全に外 | 外部 | する |
| カバレッジを跨ぐ | 外部（丸ごと） | する |

**セルは分割しない。** 跨ぐセルは丸ごと外部へ回す。
部分的な取得が起きないので、部分セルが保存される余地がない。

自前が 5xx / タイムアウト / `remark` を返したときだけ、そのグループを外部へ再送する。
カバレッジ内から返った空は「本当に道が無い」なので、そのまま返して再送しない。

`OSM_SELF_HOSTED_COVERAGE` は**セル境界（1/64°）に揃える**のが望ましい。
揃っていなくても跨ぐセルは外部へ回るので壊れない。

### 実測値（日本全体）

| 項目 | 値 |
|---|---|
| extract | 2.55 GB |
| DB | 15 GB |
| 構築時間 | 44 分 |
| ピーク RSS（構築） | 5.4 GiB |

`MemoryMax` は dispatcher と問い合わせを別々に縛る。
構築 (`overpass-init`) は `nix run` の別プロセスなので、どの unit の上限にも入らない。

- `overpass-fcgi.service`: `MemoryMax=2G`（問い合わせ。実測ピークは 512 セルで 488 MB）
- `overpass-dispatcher.service`: `MemoryMax=256M`（実測 6.2 MiB）

### クエリの負荷（実測）

自前 Overpass の結果はキャッシュしない方針である。
毎回問い合わせるため、大きい bbox の時間を把握しておく。
東京の密集部で、アプリと同じクエリを投げた実測値（無負荷時）。

| セル数 | 時間 | 応答サイズ | fcgi メモリ (peak) |
|---|---|---|---|
| 1 | 0.32 秒 | 560 KB | 24.7 MB |
| 16 | 0.81 秒 | 10.9 MB | 62.8 MB |
| 64 | 2.31 秒 | 47.5 MB | 143 MB |
| 256 | 5.93 秒 | 133 MB | 362 MB |
| 512 | 7.22 秒 | 187 MB | 488 MB |

上限 `MAX_OSM_CELLS = 512` は 7.22 秒であり 10 秒未満なので、キャッシュしない方針は成立する。
256〜512 セルは 6〜7 秒かかる点を UI 側が想定する。
クエリは `/dev/shm` を使わない（実測でクエリ中も 4 KB のまま）。

### 注意

**圧縮は 2 つとも lz4 にする。**
`update_database` は `--compression-method` と `--map-compression-method` を別に受ける。
片方だけだと DB が 6.7 倍になる（四国で 1.8 GB → 12 GB）。
`overpass-init` は両方を固定で渡す。

**`osm3s_query` は `--db-dir` を付けずに呼ぶ。**
dispatcher は `/dev/shm/osm3s_osm_base` 経由で見つかる。
`--db-dir` を付けると「dispatcher が動作中」で失敗する。

**`compute_geometry: ... not found` のログは正常。**
地域 extract では relation が extract 外の way を参照するため。
