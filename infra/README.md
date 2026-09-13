# README

<!-- ## アーキテクチャ -->

## セットアップ

```shell
# パッケージの更新・インストール
[procon@vm20025:~]$ sudo apt update
[procon@vm20025:~]$ sudo apt upgrade
[procon@vm20025:~]$ sudo apt install -y certbot nginx git nix

# 証明書の取得
[procon@vm20025:~]$ sudo certbot certonly --standalone -d procon.syoch.org

# サーバーリポジトリのクローン
[procon@vm20025:~]$ sudo mkdir -p /srv/procon
[procon@vm20025:~]$ sudo chown procon:procon /srv/procon
[procon@vm20025:~]$ git clone git@github.com:syoch/procon.git /srv/procon

# デプロイ操作
[procon@vm20025:~]$ sudo nix --extra-experimental-features nix-command --extra-experimental-features flakes run .#setup
```

## デプロイ (CI / 運用)

```shell
# VPS 上のリポジトリを同期して再実行
[procon@vm20025:~]$ git -C /srv/procon pull --ff-only
[procon@vm20025:~]$ sudo nix --extra-experimental-features nix-command --extra-experimental-features flakes run .#setup
```

また、main への push では GitHub Actions が自動で `git pull` + `nix run .#setup` を実行します (`deploy.yml`)。自動実行を NOPASSWD で通す場合のみ sudoers を設定:

```
procon ALL=(root) NOPASSWD: /nix/var/nix/profiles/default/bin/nix run --extra-experimental-features *
```
