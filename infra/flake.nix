{
  description = "WideNavi — 走りやすく安全な経路を探索する Web アプリ";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  # 本番ホスト (Ubuntu 24.04 / systemd-nspawn 255) のネスト起動と互換のある
  # systemd (256) を持つリリース。cgroup v1 サポート削除 (systemd 257+) の
  # nspawn 255 側マウントとの相互作用での起動失敗を避ける。
  inputs.nixpkgs-2411.url = "github:nixos/nixpkgs/nixos-24.11";

  outputs =
    { self, nixpkgs, nixpkgs-2411 }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      pkgs2411 = import nixpkgs-2411 { inherit system; };

      # テスト用 VM — QEMU 上で QEMU/KVM を sudo 不要で起動
      procon-test = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          ./modules/procon.nix
          ./nixos/vm-test.nix
        ];
      };

      # 本番用コンテナ — Ubuntu VPS 上の systemd-nspawn で稼働
      # nixpkgs 24.11 (systemd 256) を使用 (詳細は container.nix のコメントを参照)
      procon = nixpkgs-2411.lib.nixosSystem {
        inherit system;
        modules = [
          ./modules/procon.nix
          ./nixos/container.nix
          # 標準の LXC/nspawn コンテナモジュール (system.build.tarball を提供)
          (nixpkgs-2411 + "/nixos/modules/virtualisation/lxc-container.nix")
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
