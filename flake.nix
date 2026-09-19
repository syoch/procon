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
          nodejs_22
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
            hash = "sha256-rkrOWt6z2OPbHMFnspoFKBDVNZmgYmCqVCpyuF0y8pk=";
          };
          nativeBuildInputs = [
            pkgs.nodejs_22
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
          ExecStart=${pkgs.nodejs_22}/bin/node ${self.packages.${system}.procon-server}/index.js
          Restart=always
          User=procon
          Group=procon
          Environment=OSM_CACHE_DIR=/var/cache/procon/osm
          EnvironmentFile=/etc/procon.env

          [Install]
          WantedBy=network.target
        '';
        setup-script = pkgs.writeShellScript "setup.sh" ''
          #!/usr/bin/env bash
          set -euo pipefail

          if [ "$(id -u)" -ne 0 ]; then
            echo "This script must be run as root"
            exit 1
          fi

          ln -sf $(readlink -f "$0") /nix/var/nix/gcroots/auto/procon-setup.sh

          ln -sf ${./infra/procon-site.conf} /etc/nginx/sites-enabled/procon-site.conf
          rm -f /etc/nginx/sites-enabled/default
          ln -sf ${self.packages.${system}.procon-service-unit} /etc/systemd/system/procon-app.service

          install -d -m 0755 -o procon -g procon /var/cache/procon/osm

          systemctl daemon-reload

          systemctl enable procon-app.service
          systemctl enable nginx

          systemctl restart procon-app.service
          systemctl restart nginx

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
