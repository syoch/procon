{
  description = "WideNavi Development env";

  # procon サーバーの systemd バージョンを合わせるために nixpkgs 24.11 を使ってる
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-24.11";

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          nodejs_23
          pnpm
        ];
      };

      packages.${system} = {
        procon-server = pkgs.stdenv.mkDerivation (finalAttrs: {
          name = "procon-server";
          pname = "procon-server";
          version = "0.1.0";

          src = ./app;
          pnpmDeps = pkgs.pnpm.fetchDeps {
            inherit (finalAttrs) pname version src;
            hash = "sha256-ih4+W+jsLT5H80DYGUXbd6Hjhq4R1safo63Iyzrbxfw=";
          };
          nativeBuildInputs = [
            pkgs.nodejs_23
            pkgs.pnpm
            pkgs.pnpm.configHook
            pkgs.npmHooks.npmBuildHook
          ];
          buildPhase = ''
            runHook preBuild
            pnpm run build
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r build/* $out/
            runHook postInstall
          '';
        });
        procon-service-unit = pkgs.writeText "procon-app.service" ''
          [Unit]
          Description=ProCon App Server
          After=network.target

          [Service]
          Type=simple
          ExecStart=${pkgs.nodejs_23}/bin/node ${self.packages.${system}.procon-server}/index.js
          Restart=always
          User=procon
          Group=procon

          [Install]
          WantedBy=nginx.service
        '';
        setup-script = pkgs.writeShellScript "setup.sh" ''
          #!/usr/bin/env bash
          set -euo pipefail

          # Symlink ./infra/procon-site.conf to /etc/nginx/sites-enabled/procon-site.conf
          sudo ln -sf ${./infra/procon-site.conf} /etc/nginx/sites-enabled/procon-site.conf

          # Symlink procon-service-unit to systemd
          sudo ln -sf ${self.packages.${system}.procon-service-unit} /etc/systemd/system/procon-app.service
          sudo systemctl daemon-reload

          sudo systemctl enable procon-app.service

          sudo systemctl start procon-app.service
          sudo systemctl restart nginx

          echo "Setup complete!"
        '';
      };

      apps.${system} = {
        setup = {
          type = "app";
          program = "${self.packages.${system}.setup-script}";
        };
      };
    };
}
