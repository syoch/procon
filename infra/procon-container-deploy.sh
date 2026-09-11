#!/usr/bin/env bash
# WideNavi OS 層デプロイ (NixOS コンテナの更新)
#
# リポジトリ clone 先 (/srv/procon/infra/procon-container-deploy.sh) から直接実行する。
# サーバーに導入した Nix を使い、tarball のビルドから import まで VPS 上で完結するので
# マシン側からのビルド / scp は不要。
#
# sudoers で許可する:
#   procon ALL=(root) NOPASSWD: /srv/procon/infra/procon-container-deploy.sh
#
# 使い方:
#   procon-container-deploy.sh            # git pull → nix build → import → 起動 (通常フロー)
#   procon-container-deploy.sh <tarball>  # 任意の tarball を import (ロールバック / 手動)
#
# 注意: コンテナイメージは削除して作り直すが、
#   - アプリのチェックアウト  (/srv/procon/app)  はホスト側
#   - ACME の証明書・アカウント (/srv/procon-state/acme)
# は bind mount なので消えない。
# 成功した tarball は /srv/procon-state/tarballs/ に current / prev の 2 世代保存する。
set -euo pipefail

CONTAINER=procon
REPO_DIR=/srv/procon
TAR_DIR=/srv/procon-state/tarballs

# sudo の非対話環境では Nix が PATH に無いため明示的に追加する
# (多ユーザー install の既定位置 + シングルユーザー導入のパターン)
for p in /nix/var/nix/profiles/default/bin /root/.nix-profile/bin; do
  [ -d "$p" ] && PATH="$p:$PATH"
done
if ! command -v nix >/dev/null 2>&1; then
  echo "nix コマンドが見つかりません。VPS への Nix 導入が必要です" >&2
  exit 1
fi
# nix.conf の設定に依存しないよう、flakes はコマンドごとに渡す
NIX_FLAGS=(--extra-experimental-features "nix-command" --extra-experimental-features "flakes")

if [ "$(id -u)" -ne 0 ]; then
  echo "root で実行してください (sudo)" >&2
  exit 1
fi

TARBALL_ARG="${1:-}"
if [ -z "$TARBALL_ARG" ]; then
  echo "== 1/4 git pull =="
  runuser --login procon -- git -C "$REPO_DIR" pull --ff-only

  echo "== 2/4 NixOS コンテナ tarball を VPS 上でビルド =="
  nix build -L --out-link /tmp/procon-container-tarball "${NIX_FLAGS[@]}" "$REPO_DIR/infra#containerTarball"
  TARBALL="$(find /tmp/procon-container-tarball -name '*.tar.xz' -print -quit)"
  [ -n "$TARBALL" ] || { echo "tarball が生成されませんでした" >&2; exit 1; }
  echo "tarball: $TARBALL"
else
  echo "== tarball を指定してビルドをスキップ =="
  TARBALL="$TARBALL_ARG"
fi

echo "== 3/4 コンテナの import と起動 =="
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

echo "== 4/4 tarball の保存 (ロールバック用 2 世代) =="
mkdir -p "$TAR_DIR"
if [ -f "$TAR_DIR/procon.tar.xz" ]; then
  mv -f "$TAR_DIR/procon.tar.xz" "$TAR_DIR/procon.tar.xz.prev"
fi
if [ "$TARBALL" != "$TAR_DIR/procon.tar.xz" ]; then
  cp "$TARBALL" "$TAR_DIR/procon.tar.xz"
fi

sleep 3
machinectl status "$CONTAINER" --no-pager | head -n 12
