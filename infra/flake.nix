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
      # 開発環境 — この flake の nixpkgs (デプロイ基盤と同一 lock) を使うため、
      # dev shell とコンテナ内のツール (nodejs / pnpm) のバージョンが一致する。
      # ルートからは .envrc (use flake path:./infra) や nix develop ./infra で利用。
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          nodejs_26
          pnpm
        ];
        shellHook = ''
          echo "ProCon env"
          echo "Dev Server (run on <project>/app)"
          echo "  pnpm run dev --host 0.0.0.0 --port 10001"
          echo "Test VM:    nix build ./infra#vm  && ./result/bin/run-procon-test-vm"
          echo "Container:  nix build ./infra#containerTarball"
        '';
      };

      nixosConfigurations.procon-test = procon-test;
      nixosConfigurations.procon = procon;

      packages.${system} = {
        vm = procon-test.config.system.build.vm;
        containerTarball = procon.config.system.build.tarball;
        default = self.packages.${system}.containerTarball;
      };

      # ワンコマンド操作 (マシン側の初回セットアップを簡潔にする)
      #
      #   nix run ./infra#dev    → 開発サーバー起動 (pnpm install 込み)
      #   nix run ./infra#vm     → テスト VM をビルドして起動
      apps.${system} = {
        dev = {
          type = "app";
          program = toString (pkgs.writeShellScript "procon-dev" ''
            set -euo pipefail
            # pnpm 実行時に node が必要 (vite ランチャー等)
            export PATH="${pkgs.nodejs_26}/bin:${pkgs.pnpm}/bin:$PATH"
            if [ ! -d app ]; then
              echo "リポジトリルートで実行してください: nix run ./infra#dev" >&2
              exit 1
            fi
            cd app
            pnpm install --frozen-lockfile
            exec pnpm run dev --host 0.0.0.0 --port 10001
          '');
        };
        vm = {
          type = "app";
          program = toString (pkgs.writeShellScript "procon-run-vm" ''
            set -euo pipefail
            exec ${self.packages.${system}.vm}/bin/run-procon-test-vm
          '');
        };
      };
    };
}
