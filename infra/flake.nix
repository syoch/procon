{
  description = "WideNavi — 走りやすく安全な経路を探索する Web アプリ";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";

      # テスト用 VM — QEMU 上で QEMU/KVM を sudo 不要で起動
      procon-test = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          ./modules/procon.nix
          ./nixos/vm-test.nix
        ];
      };

      # 本番用コンテナ — Ubuntu VPS 上の systemd-nspawn で稼働
      procon = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          ./modules/procon.nix
          ./nixos/container.nix
          # 標準の LXC/nspawn コンテナモジュール (system.build.tarball を提供)
          (nixpkgs + "/nixos/modules/virtualisation/lxc-container.nix")
        ];
      };
    in
    {
      # devShell の定義はリポジトリルートの flake.nix (ローカル / git 管理外) にある

      nixosConfigurations.procon-test = procon-test;
      nixosConfigurations.procon = procon;

      packages.${system} = {
        vm = procon-test.config.system.build.vm;
        containerTarball = procon.config.system.build.tarball;
        default = self.packages.${system}.containerTarball;
      };
    };
}
