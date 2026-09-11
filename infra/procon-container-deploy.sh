#!/usr/bin/env bash
# WideNavi OS 層デプロイ (NixOS コンテナの tarball 再インポート)
#
# リポジトリ clone 先 (/srv/procon/infra/procon-container-deploy.sh) から直接実行するため、
# git pull によりこのスクリプト自体も CI/CD 経由で最新に保たれる。
# sudoers で許可する:
#   procon ALL=(root) NOPASSWD: /srv/procon/infra/procon-container-deploy.sh
#
# 使い方: procon-container-deploy.sh <tarball.tar.xz>
#
# 注意: コンテナイメージは削除して作り直すが、
#   - アプリのチェックアウト  (/srv/procon/app)  はホスト側
#   - ACME の証明書・アカウント (/srv/procon-state/acme)
# は bind mount なので消えない。
set -euo pipefail

CONTAINER=procon
TARBALL="${1:?usage: procon-container-deploy.sh <tarball.tar.xz>}"

if [ "$(id -u)" -ne 0 ]; then
  echo "root で実行してください (sudo)" >&2
  exit 1
fi

machinectl stop "$CONTAINER" 2>/dev/null || true
machinectl remove "$CONTAINER" 2>/dev/null || true

# systemd 256+ では import-tar が importctl に移行されている
# (Ubuntu 24.04 = systemd 255 は machinectl、それ以降は importctl)
if command -v importctl >/dev/null 2>&1; then
  importctl -m import-tar "$TARBALL" "$CONTAINER"
else
  machinectl import-tar "$TARBALL" "$CONTAINER"
fi

machinectl start "$CONTAINER"

sleep 3
machinectl status "$CONTAINER" --no-pager | head -n 12
