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
        # ===== 自前 Overpass (Issue #141) =====
        # procon-app とは独立に動かす。setup とは別の app にして、
        # 既存 setup (procon-app を再起動する) を流用しない。
        overpass-nginx-conf = pkgs.writeText "overpass-nginx.conf" ''
          worker_processes 1;
          error_log /run/overpass/nginx-error.log warn;
          pid /run/overpass/nginx.pid;
          events { worker_connections 64; }
          http {
            access_log off;
            client_body_temp_path /run/overpass/client_body;
            proxy_temp_path /run/overpass/proxy;
            fastcgi_temp_path /run/overpass/fastcgi;
            uwsgi_temp_path /run/overpass/uwsgi;
            scgi_temp_path /run/overpass/scgi;
            server {
              # 3000 は procon-app。Overpass は 3001 で localhost だけに出す
              listen 127.0.0.1:3001;
              location = /api/interpreter {
                include ${pkgs.nginx}/conf/fastcgi_params;
                fastcgi_pass unix:/run/overpass/fcgiwrap.sock;
                fastcgi_param SCRIPT_FILENAME ${self.packages.${system}.osm3s}/cgi-bin/interpreter;
                fastcgi_param SCRIPT_NAME /api/interpreter;
              }
            }
          }
        '';
        overpass-tmpfiles = pkgs.writeText "overpass-tmpfiles.conf" ''
          d /run/overpass 0755 overpass overpass -
        '';
        overpass-dispatcher-unit = pkgs.writeText "overpass-dispatcher.service" ''
          [Unit]
          Description=Overpass API dispatcher
          After=network.target

          [Service]
          # root では動かさない (wiki の指示)
          Type=simple
          User=overpass
          Group=overpass
          ExecStart=${self.packages.${system}.osm3s}/bin/dispatcher --osm-base --db-dir=/var/lib/overpass/db/ --allow-duplicate-queries=yes
          ExecStop=${self.packages.${system}.osm3s}/bin/dispatcher --osm-base --db-dir=/var/lib/overpass/db/ --terminate
          # Overpass 側を先に殺し、procon-app に波及させない。
          # DB 構築 (overpass-init) は runuser で走るのでこの上限の外。ここが縛るのは
          # dispatcher と問い合わせの分だけ。構築のピークは日本全体で 5.4 GiB だった
          MemoryMax=8G
          Restart=on-failure

          [Install]
          WantedBy=multi-user.target
        '';
        overpass-fcgi-unit = pkgs.writeText "overpass-fcgi.service" ''
          [Unit]
          Description=Overpass FastCGI wrapper
          After=network.target overpass-dispatcher.service
          Requires=overpass-dispatcher.service

          [Service]
          Type=simple
          User=overpass
          Group=overpass
          # -n は no fork。systemd の Type=simple で前面に置く
          ExecStart=${pkgs.spawn_fcgi}/bin/spawn-fcgi -n -s /run/overpass/fcgiwrap.sock -M 0666 -- ${pkgs.fcgiwrap}/bin/fcgiwrap
          Restart=on-failure

          [Install]
          WantedBy=multi-user.target
        '';
        overpass-nginx-unit = pkgs.writeText "overpass-nginx.service" ''
          [Unit]
          Description=Overpass HTTP API (nginx, 127.0.0.1:3001)
          After=network.target overpass-fcgi.service
          Requires=overpass-fcgi.service

          [Service]
          Type=simple
          User=overpass
          Group=overpass
          ExecStart=${pkgs.nginx}/bin/nginx -c ${self.packages.${system}.overpass-nginx-conf} -p /run/overpass -e /run/overpass/nginx-error.log -g 'daemon off;'
          Restart=on-failure

          [Install]
          WantedBy=multi-user.target
        '';
        overpass-setup-script = pkgs.writeShellScript "overpass-setup.sh" ''
          set -euo pipefail

          if [ "$(id -u)" -ne 0 ]; then
            echo "This script must be run as root"
            exit 1
          fi

          # Overpass を専用ユーザで動かす。root では動かさない
          if ! id overpass >/dev/null 2>&1; then
            useradd --system --no-create-home --home-dir /var/lib/overpass --shell /usr/sbin/nologin overpass
          fi

          install -d -m 0755 -o overpass -g overpass /var/lib/overpass
          install -d -m 0755 -o overpass -g overpass /var/lib/overpass/db

          # /run は tmpfs なので起動のたびに作り直す
          ln -sf ${self.packages.${system}.overpass-tmpfiles} /etc/tmpfiles.d/overpass.conf
          systemd-tmpfiles --create /etc/tmpfiles.d/overpass.conf

          ln -sf ${self.packages.${system}.overpass-dispatcher-unit} /etc/systemd/system/overpass-dispatcher.service
          ln -sf ${self.packages.${system}.overpass-fcgi-unit} /etc/systemd/system/overpass-fcgi.service
          ln -sf ${self.packages.${system}.overpass-nginx-unit} /etc/systemd/system/overpass-nginx.service

          systemctl daemon-reload
          systemctl enable overpass-dispatcher.service
          systemctl enable overpass-fcgi.service
          systemctl enable overpass-nginx.service

          # procon-app は再起動しない。このスクリプトは Overpass 専用
          echo "Overpass の unit とディレクトリを用意しました。"
          echo "DB を作るには: nix run .#overpass-init"
          echo "起動: systemctl start overpass-dispatcher overpass-fcgi overpass-nginx"
        '';
        overpass-init-script = pkgs.writeShellScript "overpass-init.sh" ''
          set -euo pipefail

          if [ "$(id -u)" -ne 0 ]; then
            echo "This script must be run as root"
            exit 1
          fi

          # 既定は日本全体。四国で試すなら OVERPASS_PBF_URL で差し替える
          PBF_URL="''${OVERPASS_PBF_URL:-https://download.geofabrik.de/asia/japan-latest.osm.pbf}"
          DB_DIR=/var/lib/overpass/db
          IMPORT_DIR=/var/lib/overpass/import
          OSM3S=${self.packages.${system}.osm3s}
          PBF="$IMPORT_DIR/$(basename "$PBF_URL")"

          install -d -m 0755 -o overpass -g overpass "$IMPORT_DIR"

          echo "extract を取得: $PBF_URL"
          ${pkgs.curl}/bin/curl -fSL --retry 3 --retry-delay 10 -o "$PBF" "$PBF_URL"

          # 既存 DB を作り直す。構築中はサービスを止める
          systemctl stop overpass-nginx.service overpass-fcgi.service overpass-dispatcher.service 2>/dev/null || true
          rm -rf "$DB_DIR"
          install -d -m 0755 -o overpass -g overpass "$DB_DIR"

          # bz2 は挟まない。osmconvert の XML を update_database に直接流す。
          # --compression-method と --map-compression-method の両方を lz4 にする。
          # 片方でも忘れると DB が 6.7 倍になる (四国 1.8G -> 12G)
          ${pkgs.util-linux}/bin/runuser -u overpass -- ${pkgs.bash}/bin/bash -c \
            "${pkgs.osmctools}/bin/osmconvert '$PBF' --out-osm | '$OSM3S/bin/update_database' --db-dir='$DB_DIR' --compression-method=lz4 --map-compression-method=lz4"

          rm -f "$PBF"

          systemctl start overpass-dispatcher.service
          systemctl start overpass-fcgi.service
          systemctl start overpass-nginx.service

          echo "完了しました。確認:"
          echo "  curl 'http://127.0.0.1:3001/api/interpreter?data=%5Bout%3Ajson%5D%3Bway%5B%22highway%22%5D(34.34%2C134.05%2C34.36%2C134.07)%3Bout%20body%3B%3E%3Bout%20skel%20qt%3B'"
          echo "注意: osm3s_query は --db-dir を付けずに呼ぶ。付けると失敗する"
        '';
      };

      apps.${system} = {
        setup = {
          type = "app";
          program = "${self.packages.${system}.setup-script}";
        };
        overpass-setup = {
          type = "app";
          program = "${self.packages.${system}.overpass-setup-script}";
        };
        overpass-init = {
          type = "app";
          program = "${self.packages.${system}.overpass-init-script}";
        };
      };
    };
}
