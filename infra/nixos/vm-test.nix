# ローカル統合テスト用 VM
#
#   nix build ./infra#vm && ./result/bin/run-procon-test-vm
#
# - QEMU/KVM は sudo 不要で起動できる (/dev/kvm がアクセス可能な場合)
# - ネットワークは SLiRP + ポートフォワード (tap / ブリッジ不要)
#     host:2222 -> guest:22  (ssh root@localhost -p 2222 / パスワード procontest)
#     host:8080 -> guest:80  (nginx / コンテナ経由のアプリ)
# - ホストのリポジトリが 9p で /mnt/repo に共有される (spike 用)
{
  lib,
  ...
}:

{
  networking.hostName = "procon-test";
  networking.firewall.enable = false;

  services.openssh = {
    enable = true;
    settings.PermitRootLogin = "yes"; # テスト VM のみ (パスワード: procontest)
  };

  # ホスト側では nginx / procon.service を起動しない。
  # テスト対象はコンテナ内のサービスであり、VirtualEthernet=no で
  # コンテナが VM とネットワーク名前空間を共有するためポートが競合する。
  services.nginx.enable = lib.mkForce false;
  systemd.services.procon = lib.mkForce { };

  virtualisation.vmVariant = {
    virtualisation.memorySize = 2048;
    virtualisation.cores = 2;
    virtualisation.diskSize = 12288; # MiB — コンテナイメージ (~1.5GB unpack) を import するため
    virtualisation.graphics = false; # headless (tmux 上で動かして ssh で入る)
    virtualisation.forwardPorts = [
      {
        from = "host";
        host.port = 2222;
        guest.port = 22;
      }
      {
        from = "host";
        host.port = 8080;
        guest.port = 80;
      }
    ];

    # ホストのリポジトリを 9p で /mnt/repo に共有 (spike 用)
    virtualisation.sharedDirectories.repo = {
      source = toString ./../..;
      target = "/mnt/repo";
    };
  };

  users.users.root.initialPassword = "procontest";

  system.stateVersion = "25.11";
}
