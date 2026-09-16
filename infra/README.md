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
