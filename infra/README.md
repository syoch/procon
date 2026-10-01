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

以下に各設定変数の意味を示す

#### `OVERPASS_ENDPOINT` (必須)

Overpass API のエンドポイント

#### `PROCON_CACHE_REFRESH_TOKEN` (必須)

キャッシュ更新エンドポイントの認証トークン。**未設定だと更新が全て拒否される**（`POST /api/cache-refresh` が 503 を返す）ため、`nix run .#setup` が警告を出す。引用符や空白を含まない値を入れる

#### `OSM_CACHE_TTL_DAYS` (任意)

OSM キャッシュの有効期間（日数）。未設定なら 30 日、`0` で失効させない。解釈規則は [`osm/README.md`](../app/src/routes/api/osm/README.md#取得時刻と-ttl) を参照

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

#### キャッシュ更新の手動実行

`procon-cache-refresh.timer` が OSM キャッシュの失効セルを毎日取り直す。
内部の動作は [`osm/README.md`](../app/src/routes/api/osm/README.md#定期更新) を参照。

```shell
[procon@vm20025:~]$ sudo systemctl start procon-cache-refresh.service
```
