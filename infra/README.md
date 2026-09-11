# WideNavi インフラ (NixOS nspawn コンテナ + GitHub Actions)

Ubuntu 24.04 VPS 上の `systemd-nspawn` で **NixOS コンテナ**を動かす構成。
OS 層 (nginx / nodejs / ACME / service unit) は flake で宣言し、
app 層 (SvelteKit) はコンテナ内で pnpm ビルドする。

## アーキテクチャ

```
[このマシン (NixOS)]                    [GitHub Actions]
 infra/flake.nix
  ├ modules/procon.nix  ← 共通設定 ────→  nix build ./infra#containerTarball
  ├ nixos/vm-test.nix   → QEMU VM テスト   (push to main で自動デプロイ)
  └ nixos/container.nix → nspawn tarball
                                          │ scp
[本番 VPS (Ubuntu 24.04)]                 ▼
 /etc/systemd/nspawn/procon.nspawn   (VirtualEthernet=no + Bind)
 /var/lib/machines/procon            ← machinectl import-tar
   └ NixOS コンテナ
       ├ nginx :80/:443 (security.acme)
       └ procon.service :3000 (SvelteKit adapter-node)
 /srv/procon/    git チェックアウト (deploy key はホストのみ)
   └ app/ ──Bind──→ コンテナ /srv/app (pnpm build はコンテナ内)
```

### 設計上のポイント

| 項目 | 内容 |
|------|------|
| OS 層の宣言 | 標準モジュール `lxc-container.nix` (`system.build.tarball`) を使用 |
| テスト ≒ 本番 | `infra/modules/procon.nix` を VM とコンテナで共有 — テストしたものを出荷 |
| 締め出し対策 | `VirtualEthernet=no` でホスト netns 共有 → **netplan / firewall に一切触れない** |
| 秘密鍵 | deploy key はホストのみ。tarball に秘密情報は含まない |
| sudoers | NOPASSWD は 2 スクリプトのみ (`procon-app-deploy.sh` / `procon-container-deploy.sh`) |
| ロールバック | 以前の tarball を `procon-container-deploy.sh` に渡して再インポート |

## 開発環境 (マシン側の初回セットアップ)

新規マシン / 新規 clone の場合、必要なのは **Nix (flakes 有効なバージョン) のみ**:

```bash
git clone git@github.com:syoch/procon.git
cd procon
nix run ./infra#dev      # pnpm install 込みで開発サーバー起動 → http://localhost:10001
```

- devShell 定義 (`nodejs_26` / `pnpm`) は `infra/flake.nix` 内にあり、
  **デプロイ基盤と同一の nixpkgs lock** を使うため、
  dev shell とコンテナ内でツールのバージョンが一致する
- direnv + nix-direnv を使う場合は `.envrc` (`use flake path:./infra`) で
  `direnv allow` 以降は自動的に環境が入る

| コマンド | 内容 |
|---------|------|
| `nix run ./infra#dev` | 依存解決 → 開発サーバー起動 (:10001) |
| `nix run ./infra#vm` | テスト VM をビルドして QEMU で起動 |
| `nix build ./infra#containerTarball` | 本番コンテナ tarball をビルド |

## ローカルテスト (このマシン / sudo 不要)

```bash
# VM をビルドして起動 (headless / tmux 推奨)
nix run ./infra#vm
# → 別ターミナルから ssh -p 2222 root@127.0.0.1 (パスワード: procontest)

# コンテナ tarball をビルド
nix build ./infra#containerTarball
# → result/tarball/nixos-system-x86_64-linux.tar.xz
```

## 本番 VPS 初期構築 (一度だけ)

専用スクリプトは使わない。初回も**2 回目以降と同じ deploy フロー**を踏む。

### A. 依存パッケージ (VPS 上 / sudo)

```bash
sudo apt install -y systemd-container git
```

### B. リポジトリ clone と鍵 (VPS 上 / procon ユーザー)

```bash
# deploy key を生成し、出力された公開鍵を GitHub に登録 (手動)
ssh-keygen -t ed25519 -f ~/.ssh/procon_deploy -N '' -C "procon-vps-deploy"
cat ~/.ssh/procon_deploy.pub
#  → GitHub > Settings > Deploy keys (read-only) に登録

# ~/.ssh/config に追記して deploy key を使う
cat >> ~/.ssh/config <<'CONF'
Host github.com
  IdentityFile ~/.ssh/procon_deploy
CONF

sudo install -d -o procon /srv/procon
git clone git@github.com:syoch/procon.git /srv/procon

# CI 用公開鍵もこのタイミングで authorized_keys に追記 (手動・任意)
```

### C. sudoers の作成 (VPS 上 / sudo) — スクリプトは設置しない

deploy スクリプトは clone されたリポジトリ (`/srv/procon/infra/`) から直接実行する。
このため CI の `git pull` によりスクリプト群自体も自動更新される
(`/usr/local/bin` への配置・更新は不要)。

```bash
sudo install -m 644 /srv/procon/infra/procon.nspawn /etc/systemd/nspawn/
sudo install -d -m 755 /srv/procon-state/acme
printf 'procon ALL=(root) NOPASSWD: /srv/procon/infra/procon-app-deploy.sh, /srv/procon/infra/procon-container-deploy.sh\n' \
  | sudo tee /etc/sudoers.d/procon-deploy
sudo chmod 440 /etc/sudoers.d/procon-deploy
```

### D. 2 回以降と同じフローで構築・起動

```bash
# OS 層デプロイ (マシン側で tarball をビルドして scp)
#   マシン: nix build ./infra#containerTarball
#   マシン: scp result/tarball/*.tar.xz procon@<VPS>:/tmp/procon.tar.xz
sudo /srv/procon/infra/procon-container-deploy.sh /tmp/procon.tar.xz

# app 層デプロイ初回 (clone 済みなので pull → build → 起動)
sudo /srv/procon/infra/procon-app-deploy.sh

# 確認
curl http://127.0.0.1/api/health
```

## Cloudflare / TLS

1. DNS: `procon.syoch.org` (プロキシ済み A レコード) — 済み
2. Cloudflare SSL/TLS モードを **Full (strict)** に変更
3. 証明書はコンテナ内 `security.acme` (HTTP-01) が自動取得・更新
   - 初回発行はコンテナ起動後数十秒。`sudo machinectl shell procon systemctl status acme-procon.syoch.org` で確認

## GitHub Actions

必要な Secrets:

| Secret 名 | 内容 |
|-----------|------|
| `VPS_SSH_KEY` | CI 用 SSH 秘密鍵 (VPS の `~/.ssh/authorized_keys` に公開鍵を追加) |
| `VPS_HOST_KEY` | `ssh-keyscan <VPS IP>` の出力 (known_hosts 用) |
| `VPS_HOST` | `procon@<VPS IP>` |

動作:

| イベント | ジョブ |
|---------|--------|
| PR 作成・更新 | build のみ (pnpm check + tarball ビルド) |
| main へのマージ (push) | build + deploy-app (常時) + deploy-os (Nix 設定変更時のみ) |

## 日常のデプロイフロー

```
コード変更 → PR → CI build (緑確認) → main マージ
  → Actions が自動デプロイ
  → https://procon.syoch.org/api/health で確認
```

手動実行する場合:

```bash
# app 層 (数十秒)
ssh procon@<VPS> sudo /srv/procon/infra/procon-app-deploy.sh

# OS 層 (Nix 設定変更後。tarball を再ビルドして渡す)
nix build ./infra#containerTarball
scp result/tarball/*.tar.xz procon@<VPS>:/tmp/procon.tar.xz
ssh procon@<VPS> sudo /srv/procon/infra/procon-container-deploy.sh /tmp/procon.tar.xz
```

## 運用コマンド

```bash
sudo machinectl list                  # コンテナ一覧
sudo machinectl status procon         # コンテナの状態
sudo machinectl shell procon          # コンテナに root ログイン
sudo journalctl -M procon -u procon -f   # アプリのログ
sudo systemctl -M procon status nginx    # コンテナ内 nginx
```

## トラブルシューティング

| 症状 | 確認箇所 |
|------|---------|
| 502 Bad Gateway | `sudo systemctl -M procon status procon` — ビルド成果物 (`/srv/app/build`) の有無 |
| 証明書が取れない | Cloudflare SSL モードが Full (strict) か。`journalctl -M procon -u acme-procon.syoch.org` |
| git pull 失敗 | deploy key の登録と `~/.ssh/config`、`sudo machinectl shell procon@procon` の権限 |
| コンテナが起動しない | `sudo machinectl status procon`、`journalctl -u systemd-nspawn@procon` |
| OS デプロイ後 502 | bind mount 確認 (`procon.nspawn` の Bind 行) — app の再ビルドが必要 |
| コンテナ内で /srv/app の書き込みができない | `procon.nspawn` の `[Exec] PrivateUsers=no` があるか (userns で uid がずれる) |

## 注意事項

- **firewall / netplan はこの構成では一切扱わない。** UFW 等を VPS 上で手動設定する場合は、作業前に**別セッションで SSH を開いたまま**にすること。
- `machinectl remove procon` はコンテナイメージ内のみ消す。app (`/srv/procon`) と証明書 (`/srv/procon-state/acme`) はホスト側なので消失しない。
