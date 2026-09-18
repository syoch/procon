{
  description = "WideNavi Development env";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      nodePkg = pkgs.nodejs_26;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          nodePkg
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
            nodePkg
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
          ExecStart=${nodePkg}/bin/node ${self.packages.${system}.procon-server}/index.js
          Restart=always
          User=procon
          Group=procon

          [Install]
          WantedBy=network.target
        '';
        setup-script = pkgs.writeShellScript "setup.sh" ''
          #!/usr/bin/env bash
          set -euo pipefail

          sudo ln -sf $(readlink -f "$0") /nix/var/nix/gcroots/auto/procon-setup.sh

          sudo ln -sf ${./infra/procon-site.conf} /etc/nginx/sites-enabled/procon-site.conf
          sudo rm -f /etc/nginx/sites-enabled/default
          sudo ln -sf ${self.packages.${system}.procon-service-unit} /etc/systemd/system/procon-app.service

          sudo systemctl daemon-reload

          sudo systemctl enable procon-app.service
          sudo systemctl enable nginx

          sudo systemctl restart procon-app.service
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
