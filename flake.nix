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
            hash = "sha256-nMji8Hh7clQP5RsnW58yXGxrGGB1zBlHl8c+6QCd3EI=";
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
        osm3s = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "osm3s";
          version = "0.7.62";

          src = pkgs.fetchurl {
            url = "https://dev.overpass-api.de/releases/osm-3s_v${finalAttrs.version}.tar.gz";
            hash = "sha256-MimAlodtczWohlkCZJxpwDQWdNmIZzj5RCGT9oU8s+U=";
          };

          # configure は tarball に同梱されている。autoconf や automake は要らない。
          # 0.7.62 は現行 gcc でそのままビルドできるので postPatch は不要。
          # nixpkgs を更新して C++ の既定が変わったら postPatch が要るかもしれない
          buildInputs = [
            pkgs.expat
            pkgs.zlib
            pkgs.lz4
          ];
          # lz4 圧縮データベースを有効にする。configure.ac の既定は no なので明示する
          configureFlags = [ "--enable-lz4" ];

          # stripDebugList は既定 (bin/lib など) を上書きする。
          # cgi-bin を足すときは既定も並べないと bin/osm3s_query (201 MB) が
          # 未 strip のまま残り、closure に gcc と -dev が入る。
          # cgi-bin は削除せず strip だけする (fcgiwrap が interpreter を使う)
          stripDebugList = [
            "bin"
            "sbin"
            "lib"
            "lib64"
            "libexec"
            "cgi-bin"
          ];

          meta = {
            description = "Overpass API server";
            homepage = "https://overpass-api.de/";
          };
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
          # 既定は 0.0.0.0 で、nginx の拒否を迂回して :3000 を直叩きできてしまう。
          # nginx と同じホストにあるので localhost 束縛で運用する
          Environment=HOST=127.0.0.1
          EnvironmentFile=/etc/procon.env
          # ファイルが無くても起動を妨げない
          EnvironmentFile=-/etc/procon-head-hash.env

          [Install]
          WantedBy=network.target
        '';
        procon-cache-refresh-service = pkgs.writeText "procon-cache-refresh.service" ''
          [Unit]
          Description=ProCon OSM Cache Refresh
          # After= だけでは依存先の起動は起こらない
          After=network.target procon-app.service
          Wants=procon-app.service

          [Service]
          # RemainAfterExit=yes は付けない。反復タイマでは 1 回だけ起動して
          # active (exited) のまま残り、TTL 更新が永久に動かなくなる (実測で確認)
          Type=oneshot
          EnvironmentFile=/etc/procon.env
          User=procon
          Group=procon
          # 波括弧は必須。ドル記号だけだと独立した単語として扱われず
          # ヘッダの一部ではリテラルのまま送られ、毎晩 401 になる
          # --fail-with-body は exit code を保ったまま本文を journal に出す
          ExecStart=${pkgs.curl}/bin/curl --fail-with-body -sS -X POST --max-time 600 \
            -H "x-procon-cache-refresh: ''${PROCON_CACHE_REFRESH_TOKEN}" \
            http://127.0.0.1:3000/api/cache-refresh
        '';
        procon-cache-refresh-timer = pkgs.writeText "procon-cache-refresh.timer" ''
          [Unit]
          Description=ProCon OSM Cache Refresh Timer

          [Timer]
          OnCalendar=*-*-* 04:00:00
          # 停止していた期間ぶんは次回起動時にまとめて実行する
          Persistent=true
          # Overpass 側の混雑を避ける
          RandomizedDelaySec=1800

          [Install]
          WantedBy=timers.target
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
          ln -sf ${self.packages.${system}.procon-cache-refresh-service} /etc/systemd/system/procon-cache-refresh.service
          ln -sf ${self.packages.${system}.procon-cache-refresh-timer} /etc/systemd/system/procon-cache-refresh.timer

          install -d -m 0755 -o procon -g procon /var/cache/procon/osm

          # .git が無い環境では空文字列になる
          procon_head_hash=$(git -C /srv/procon rev-parse HEAD 2>/dev/null || true)
          if [ -z "$procon_head_hash" ]; then
            procon_head_hash=no-git
          else
            procon_dirty=$(git -C /srv/procon status --porcelain 2>/dev/null || true)
            if [ -n "$procon_dirty" ]; then
              procon_head_hash=''${procon_head_hash}-dirty
            fi
          fi
          printf 'PROCON_HEAD_HASH=%s\n' "$procon_head_hash" > /etc/procon-head-hash.env
          chmod 0644 /etc/procon-head-hash.env

          systemctl daemon-reload

          systemctl enable procon-app.service
          systemctl enable nginx

          systemctl restart procon-app.service
          systemctl restart nginx

          # enable だけでは timer が発火しない (起動は別操作)。
          # enable と start を分けるのは、Persistent=true で 04:00 を
          # 飛ばしていると enable 直後に発火するため。アプリが再起動で
          # 応答するまで待ってから発火させる
          systemctl enable procon-cache-refresh.timer
          systemctl start procon-cache-refresh.timer

          echo "Setup complete!"
          echo "キャッシュ更新のスケジュールは procon-cache-refresh.timer で有効化されています。"

          # トークンが無いと毎晩更新が 503 で失敗する。setup は成功したように
          # 見えるので、ここで触っておかないと原因が追究できない
          if ! grep -q '^PROCON_CACHE_REFRESH_TOKEN=..' /etc/procon.env 2>/dev/null; then
            echo ""
            echo "警告: /etc/procon.env に PROCON_CACHE_REFRESH_TOKEN がありません。"
            echo "キャッシュ更新 (/api/cache-refresh) は全リクエストを拒否するため、"
            echo "procon-cache-refresh.timer は毎晩失敗します。"
            echo "追加方法 (infra/README.md 参照):"
            echo "  sudo sh -c 'echo PROCON_CACHE_REFRESH_TOKEN=\$(openssl rand -hex 32) >> /etc/procon.env'"
            echo "  sudo systemctl restart procon-app.service"
          fi
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
