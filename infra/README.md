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
