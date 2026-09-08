{
  description = "WideNavi — 走りやすく安全な経路を探索する Web アプリ";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };

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
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_26
          pkgs.pnpm
        ];
        shellHook = ''
          echo "ProCon env"
          echo "Dev Server (run on <project>/app)"
          echo "  pnpm run dev --host 0.0.0.0 --port 10001"
          echo "Test VM:    nix build .#vm  && ./result/bin/run-procon-test-vm"
          echo "Container:  nix build .#containerTarball"
        '';
      };

      nixosConfigurations.procon-test = procon-test;
      nixosConfigurations.procon = procon;

      packages.${system} = {
        vm = procon-test.config.system.build.vm;
        containerTarball = procon.config.system.build.tarball;
        default = self.packages.${system}.containerTarball;
      };
    };
}
