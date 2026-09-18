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
