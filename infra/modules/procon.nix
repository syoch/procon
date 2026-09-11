# WideNavi アプリの共通 NixOS モジュール
#
# VM (テスト: nixosConfigurations.procon-test) と
# 本番コンテナ (nixosConfigurations.procon) の両方から import される。
# 「テストで検証した構成をそのまま本番へ出荷する」ための唯一の設定源。
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.procon;
  nodePkg = pkgs.nodejs_22;
in
{
  options.procon = {
    production = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "本番構成 (security.acme / ORIGIN を有効化) のとき true。container.nix でのみ設定される";
    };

    domain = lib.mkOption {
      type = lib.types.str;
      default = "procon.syoch.org";
      description = "サービスのドメイン (Cloudflare プロキシされた A レコード)";
    };

    appDir = lib.mkOption {
      type = lib.types.str;
      default = "/srv/app";
      description = "SvelteKit アプリ (リポジトリの app/ ディレクトリ) のパス";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "SvelteKit (adapter-node) の Listen ポート";
    };
  };

  config = {
    # サービス実行ユーザー。
    # VPS ホスト側の ssh ユーザー (procon, uid 1000) と数値 uid を揃えることで、
    # bind mount (/srv/app) のファイル所有権がホスト・コンテナで一致する。
    users.users.procon = {
      isSystemUser = true;
      uid = 1000;
      group = "procon";
      home = "/home/procon";
      createHome = true;
      useDefaultShell = true;
    };
    users.groups.procon.gid = 1000;

    environment.systemPackages = with pkgs; [
      curl
      git
      nodePkg
      pnpm
    ];

    # SvelteKit (adapter-node) サーバー
    systemd.services.procon = {
      description = "WideNavi SvelteKit server";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      environment = {
        PORT = toString cfg.port;
        HOST = "127.0.0.1";
        NODE_ENV = "production";
      } // lib.optionalAttrs cfg.production {
        # Cloudflare プロキシ越しでも CSRF / origin チェックが正しく働くように
        ORIGIN = "https://${cfg.domain}";
      };
      serviceConfig = {
        Type = "simple";
        User = "procon";
        Group = "procon";
        WorkingDirectory = cfg.appDir;
        ExecStart = "${nodePkg}/bin/node ${cfg.appDir}/build/index.js";
        Restart = "on-failure";
        RestartSec = 5;
      };
    };

    services.nginx = {
      enable = true;
      recommendedProxySettings = true;
      virtualHosts.${cfg.domain} = {
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.port}";
          proxyWebsockets = true;
        };
      }
      // lib.optionalAttrs cfg.production {
        # 本番のみ TLS。ACME HTTP-01 は Cloudflare プロキシ経由でも検証できる
        enableACME = true;
        forceSSL = true;
      };
    };

    security.acme = lib.mkIf cfg.production {
      acceptTerms = true;
      defaults.email = "syoch64@gmail.com";
    };
  };
}
