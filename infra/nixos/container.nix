# 本番用コンテナ設定
#
# 標準モジュール nixos/modules/virtualisation/lxc-container.nix を import し、
# systemd-nspawn 互換の rootfs tarball (system.build.tarball) を生成可能にする。
#
#   nix build ./infra#containerTarball
#   → result/ 配下の nixos-system-x86_64-linux.tar.xz
#
# 導入は infra/README.md を参照 (machinectl import-tar)。
#
# NOTE: nixpkgs 24.11 (systemd 256) を使用。
#   Ubuntu 24.04 ホスト (systemd-nspawn 255) では NixOS のツリーが
#   systemd 非搭載と判定され /sys/fs/cgroup に tmpfs が張られ、
#   cgroup v1 サポートが削除された systemd 257+ (unstable) は起動直後に
#   "Detected unsupported legacy cgroup hierarchy, refusing execution" で死ぬ。
#   systemd 256 は Ubuntu ネスティング環境と同等の組み合わせで動作する。
{
  config,
  lib,
  pkgs,
  ...
}:

{
  # 標準モジュール nixos/modules/virtualisation/lxc-container.nix の import は
  # flake.nix 側で行う (imports 内での pkgs 参照は無限再帰になるため)

  procon.production = true;

  networking.hostName = "procon";
  # /etc/systemd/nspawn/procon.nspawn で VirtualEthernet=no を指定するため
  # ホストとネットワーク名前空間を共有する。コンテナ内の firewall を有効化すると
  # ホスト側のパケットフィルタと衝突するため無効化する。
  networking.firewall.enable = false;

  documentation.enable = lib.mkForce false;

  # (24.11 の標準モジュールは installInitScript activation script を
  #  既に提供するため、留意のみ。25.11 系では lib.mkForce での再定義が必要だった)
  # tarball 再インポート (machinectl remove + import-tar) でコンテナ内の
  # /var/lib/acme が消え、証明書が毎回再発行されるのを防ぐため、
  # ホストの /srv/procon-state/acme を bind mount する前提の所有権調整。
  # (README の procon.nspawn [Files] Bind= を参照)
  systemd.services.procon-acme-perms = {
    description = "acme 用 bind mount の所有者を acme ユーザーに揃える";
    before = [ "acme-procon.syoch.org.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.coreutils}/bin/chown -R acme:acme /var/lib/acme";
    };
  };

  system.stateVersion = "24.11";
}
