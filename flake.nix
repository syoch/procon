{
  description = "WideNavi Development env";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/release-26.05";

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      nodePkg = pkgs.nodejs_26;
      pnpmPkg = pkgs.pnpm_11;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [
          nodePkg
          pnpmPkg
        ];
      };

      packages.${system} = {
        procon-server = pkgs.stdenv.mkDerivation (finalAttrs: {
          name = "procon-server";
          pname = "procon-server";
          version = "0.1.0";

          src = ./app;
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            hash = "sha256-wW/SDv+MDvcegJ9AJAhtdQGCmvwMZLVsYY2q7j3iheE=";
            fetcherVersion = 3;
          };
          nativeBuildInputs = [
            nodePkg
            pnpmPkg
            pkgs.pnpmConfigHook
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
          ExecStart=${nodePkg}/bin/node ${self.packages.${system}.procon-server}/index.js
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
