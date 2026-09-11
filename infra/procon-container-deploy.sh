#!/usr/bin/env bash
# WideNavi OS 層デプロイ (NixOS コンテナ / ホスト store bind-mount 方式)
#
# リポジトリ clone 先 (/srv/procon/infra/procon-container-deploy.sh) から直接実行する。
# tarball は使わない: VPS 上で nix build したクロージャをホストの /nix/store から
# コンテナに bind mount し、rootfs は symlink 3 本だけの最小構成にする。
#
# sudoers で許可する:
#   procon ALL=(root) NOPASSWD: /srv/procon/infra/procon-container-deploy.sh
#
# 使い方:
#   procon-container-deploy.sh            # 通常デプロイ (初回は rootfs を自動 bootstrap)
#   procon-container-deploy.sh rollback   # 直前の構成へ戻す
#
# 仕組み:
#   - コンテナ rootfs (/var/lib/machines/procon) は symlink だけの最小構成:
#       nix/var/nix/profiles/system → /nix/store/<toplevel>
#       sbin/init                   → <toplevel>/init
#       etc/os-release              → <toplevel>/etc/os-release
#       usr/lib/systemd/systemd     → <systemd>/lib/systemd/systemd
#         (nspawn 255 が NixOS tree を systemd 無しと誤判定して /sys/fs/cgroup に
#          tmpfs を張り、ネスト systemd が起動に失敗するのを防ぐ検出用 symlink)
#     /nix/store 自体は procon.nspawn の BindReadOnly でホストから共有する。
#   - nix build したクロージャは GC root (gcroots/auto) に登録して保護する。
#   - 現構成はロールバック用に /srv/procon-state/system.prev に退避する。
#   - 旧 tarball 方式のレガシー rootfs (埋め込み store) を検出したら作り直す。
#
# 注意: コンテナは毎回作り直されるが、
#   - アプリのチェックアウト  (/srv/procon/app)  はホスト側
#   - ACME の証明書・アカウント (/srv/procon-state/acme)
# は bind mount なので消えない。
set -euo pipefail

CONTAINER=procon
REPO_DIR=/srv/procon
STATE_DIR=/srv/procon-state
MACHINE_DIR=/var/lib/machines/procon
GCROOT_DIR=/nix/var/nix/gcroots/auto
GCROOT="$GCROOT_DIR/procon-container"
GCROOT_PREV="$GCROOT_DIR/procon-container.prev"
UNIT="systemd-nspawn@$CONTAINER.service"

# sudo の非対話環境では Nix が PATH に無いため明示的に追加する
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

echo "== 1/4 git pull =="
runuser --login procon -c "git config --global --replace-all safe.directory $REPO_DIR" >/dev/null
runuser --login procon -c "git -C $REPO_DIR pull --ff-only"

TOPLEVEL=""
if [ "${1:-}" = "rollback" ]; then
  if [ ! -s "$STATE_DIR/system.prev" ]; then
    echo "ロールバック先 (.prev) がありません" >&2
    exit 1
  fi
  TOPLEVEL="$(cat "$STATE_DIR/system.prev")"
  echo "== 2/4 ロールバック: 直前の構成に戻す =="
else
  echo "== 2/4 NixOS クロージャを VPS 上でビルド =="
  nix build -L --out-link "$GCROOT" "${NIX_FLAGS[@]}" "$REPO_DIR/infra#toplevel"
  TOPLEVEL="$(readlink -f "$GCROOT")"
fi
echo "toplevel: $TOPLEVEL"
[ -d "$TOPLEVEL" ] || { echo "toplevel が存在しません: $TOPLEVEL" >&2; exit 1; }

# コンテナの systemd (nspawn 255 の検出用) を GC root 付きで確保
nix build -L --out-link "$STATE_DIR/systemd" "${NIX_FLAGS[@]}" "$REPO_DIR/infra#containerSystemd" >/dev/null
SYSTEMD_STORE="$(readlink -f "$STATE_DIR/systemd")"

echo "== 3/4 コンテナ rootfs の準備 =="
if [ -d "$MACHINE_DIR/nix/store" ] && [ ! -L "$MACHINE_DIR/nix/store" ]; then
  echo "旧 tarball 方式 (埋め込み store) を検出 → rootfs を作り直します"
  machinectl stop "$CONTAINER" 2>/dev/null || true
  rm -rf "$MACHINE_DIR"
fi

if [ ! -d "$MACHINE_DIR" ]; then
  echo "初回: 最小 rootfs を構築"
fi

# mount ターゲット (/proc /sys /dev) は nspawn 自動作成対象ではなく
# 事前に存在している必要がある (旧 make-system-tarball は extraCommands で作成)
mkdir -p \
  "$MACHINE_DIR/nix/var/nix/profiles" \
  "$MACHINE_DIR/etc" \
  "$MACHINE_DIR/sbin" \
  "$MACHINE_DIR/usr/lib/systemd" \
  "$MACHINE_DIR/lib/systemd" \
  "$MACHINE_DIR/proc" \
  "$MACHINE_DIR/sys" \
  "$MACHINE_DIR/dev"

# ロールバック用に現構成を退避してから symlink を最新に張り替え
old_target="$(readlink "$MACHINE_DIR/nix/var/nix/profiles/system" 2>/dev/null || true)"
if [ -n "$old_target" ] && [ "$old_target" != "$TOPLEVEL" ]; then
  printf '%s\n' "$old_target" > "$STATE_DIR/system.prev"
  ln -sfn "$old_target" "$GCROOT_PREV"
fi
ln -sfn "$TOPLEVEL" "$MACHINE_DIR/nix/var/nix/profiles/system"
ln -sfn "$TOPLEVEL/init" "$MACHINE_DIR/sbin/init"
ln -sfn "$TOPLEVEL/etc/os-release" "$MACHINE_DIR/etc/os-release"
ln -sfn "$SYSTEMD_STORE/lib/systemd/systemd" "$MACHINE_DIR/usr/lib/systemd/systemd"
ln -sfn "$SYSTEMD_STORE/lib/systemd/systemd" "$MACHINE_DIR/lib/systemd/systemd"
# GC root: step 2/4 の nix build --out-link "$GCROOT" が symlink として作成済み
# (ここでは上書きしない — symlink に対するリダイレクトは "Is a directory" で失敗する)

echo "== 4/4 コンテナの再起動 =="
if ! systemctl restart "$UNIT"; then
  echo "コンテナユニットの起動に失敗しました。直近のログ:" >&2
  journalctl -u "$UNIT" -n 40 --no-pager || true
  exit 1
fi

sleep 3
if ! systemctl is-active --quiet "$UNIT"; then
  echo "コンテナユニットが active ではありません。直近のログ:" >&2
  journalctl -u "$UNIT" -n 40 --no-pager || true
  exit 1
fi
machinectl status "$CONTAINER" --no-pager | head -n 12
