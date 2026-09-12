#!/usr/bin/env bash
# WideNavi アプリ更新 (app 層デプロイ)
#
# リポジトリ clone 先 (/srv/procon/infra/procon-app-deploy.sh) から直接実行するため、
# git pull によりこのスクリプト自体も CI/CD 経由で最新に保たれる。
# sudoers で許可する:
#   procon ALL=(root) NOPASSWD: /srv/procon/infra/procon-app-deploy.sh
#
# 流れ:
#   1. VPS ホスト側の /srv/procon で git pull (deploy key はホストの procon ユーザー)
#   2. コンテナ内 (procon@procon) で pnpm install / build
#   3. コンテナ内で procon.service を再起動
#
# 前提:
#   - /srv/procon の所有者は uid 1000 (ホストの procon ユーザーと同じ)
#   - コンテナ procon が起動済みで /srv/app に bind mount 済み
set -euo pipefail

REPO_DIR=/srv/procon
CONTAINER=procon
REPO_URL="git@github.com:syoch/procon.git"
APP_UID=1000

if [ "$(id -u)" -ne 0 ]; then
  echo "root で実行してください (sudo)" >&2
  exit 1
fi

# 1. git (ホストの procon ユーザー権限で実行 — 所有権を uid 1000 に保つため)
#
# 注意: runuser --login に -- を付けてコマンドを渡すと「コマンド」ではなく
# 「シェル起動スクリプトへの引数」として渡されるため、bash は第 1 引数を
# スクリプトファイルとして開こうとして ENOEXEC ('cannot execute binary file')
# で失敗する。-c で渡すこと。
runuser --login procon -c "git config --global --replace-all safe.directory $REPO_DIR" >/dev/null

if [ ! -d "$REPO_DIR/.git" ]; then
  mkdir -p "$REPO_DIR"
  chown "$APP_UID:$APP_UID" "$REPO_DIR"
  runuser --login procon -c "git clone $REPO_URL $REPO_DIR"
fi
runuser --login procon -c "git -C $REPO_DIR pull --ff-only"

# 2. ビルド (コンテナ内の procon ユーザー)
# machinectl shell の PTY 出力は非対話環境では失われるため、
# ログファイルに書き出してから表示する
machinectl shell "procon@$CONTAINER" /run/current-system/sw/bin/bash -lc '
  set -e
  # CI=true: pnpm の modules directory purge 確認 (TTY なし) を抑制
  export CI=true
  cd /srv/app
  {
    echo "== pnpm =="
    pnpm --version || true
    echo "== install =="
    pnpm install --frozen-lockfile
    echo "== build =="
    pnpm build
  } > /srv/app/deploy-build.log 2>&1
'
tail -n 20 "/srv/procon/app/deploy-build.log"

# 3. 再起動 (コンテナ内 root)
machinectl shell "$CONTAINER" /run/current-system/sw/bin/systemctl restart procon
machinectl shell "$CONTAINER" /run/current-system/sw/bin/systemctl is-active procon
