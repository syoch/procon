# AGENTS.md

このファイルは LLM エージェントの作業指示です。
人間向けの読み書は [`docs/`](./docs/) にあります。

## 参照する文書

| 文書 | 内容 |
|---|---|
| [`docs/開発フロー.md`](./docs/開発フロー.md) | ブランチ運用・試験用ページの扱い |
| [`docs/設計/`](./docs/設計/) | グラフモデル、スコアリング、一方通行、キャッシュ、ページ状態、bench ゲート |
| [`infra/README.md`](./infra/README.md) | デプロイ基盤（NixOS nspawn + GitHub Actions） |
| [`app/bench/README.md`](./app/bench/README.md) | ベンチマークの実行と比較 |

実装箇所の状態を列挙した表は保守コストが高いため置きません。
`git ls-files` / `rg` で見てください。

## 作業の流れ

### Issue から始める

`gh issue create` で Issue を作り、Milestone と Project を設定してからコードを書き始めます。

- Project「プロコン」（number 2、ID `PVT_kwHOAu9HaM4BdpD9`）に登録する
- Status の約束は **OPEN → `Todo` / CLOSED → `Done`**
- 具体的な手順とフィールド ID は `.agents/skills/issue-pr-worktree-flow/` にまとめる

### worktree で作業する

```bash
git fetch origin
git worktree add -b <Type>/<Issue>-<ShortDesc> /tmp/opencode/wt-<Issue> origin/main
```

`git worktree add` は追跡ファイルしか作らないので、`AGENTS.md` と `.agents/` は
**存在しません。**
存在しないので `mkdir` で作ります。
委譲する場合は `AGENTS.md` と `.agents/` をシンボリックリンクで対象へ結びます。

### 委任する（OpenCode Web API）

長い作業は別セッションに委任します。
1 セッション 1 作業を原則にします。
自分でループを皆有するとコンテキストが潰れるので、分けて上限を待ちます。

サーバーは systemd の `opencode.service`（port 12000）を使います。

```json
{ "model": { "providerID": "...", "modelID": "..." }, "parts": [{ "type": "text", "text": "..." }] }
```

- `model` は入れ子にする。トップレベルの `providerID` / `modelID` は不正
- セッション ID はディレクトリで絞り込む:
  `GET /session?directory=/tmp/opencode/wt-<Issue>`
- `noReply: true` は fire-and-forget ではない。セッション状態を必ず確認する

### 検証してから push する

```bash
nix develop -c pnpm -C app check    # 型検査
nix develop -c pnpm -C app test     # テスト
nix develop -c pnpm -C app lint     # eslint（bench 変更前からエラーあり）
```

`node` / `pnpm` は `nix develop` 経由です。
flake.nix はリポジトリルートにあります。
`app/` で実行すると `path does not contain a 'flake.nix'` が出ます。

## 日本語を書くときの注意

**長い日本語の散文（本Issue 文・PR 本文・設計資料）は生成劣化が起きる。**
1500 文字を超えると、繰り返し・無関係語の混入・言語混入（ハングル・簡体字・
キリル文字）・字形の誤変換が現れる。既知の例:

- 造語の混成や無関係語の唐突な混入
- 中国語・ロシア語の混入
- 見慣れた字の誤変換（解除 → 解象など）
- 文の破綻

### 効果のあった対策

1. **JSON を直接書かない。**
   `body` を `body.md`、`comments` を `c1.md` … に分割し、`json.dumps` で組み立てる。
   エスケープ事故も混入も減ります。

2. **1 文を短く保つ。** 1 文 40 文字以内。

3. **1 文 1 行で書く。** 折り返さない。句点で区切って次の行にする。

4. **投稿前に混入をスキャンする。**
   コードフェンス内と行内コードを除外してから U+FFFD・ハングル・簡体字・
   キリル文字・不自然な英単語を探す。

5. **検出後に `read` で目視する。**
   スキャナは完璧ではありません。
   技術語のために緩めた結果を見落とします。
   目視が最後の砦です。

### 長文が安全に書けない場合

**生成を分割します。** セクションごとに別ファイルに書いて結合する。
1 回の生成で 1500 文字を超えないようにするのがコツです。

README や設計資料のように長い日本語を生成する必要がある場面では、
特にこの方針を適用します。

## ドキュメントとコメント

### 情報の置き場所

情報の**行き先**を決めてから書きます。

| 情報 | 置き場所 |
|---|---|
| 作業のための知識（ツールの構文・API の書き方） | skill か `memory_*` |
| 設計判断（なぜその方式を選んだか） | Markdown |
| ロジック（その行が何をするか） | コードのコメント |

**設計判断をコードコメントに書かない。** コードは「動いている説明」だけを持ちます。
**構文の知識をドキュメントに書かない。** 運用者はそれを読まない。

### 守ること

- **1 文 1 行**。折り返さない。1 行に 2 文以上書かない
- **肯定形で書く。** 「〜できない」ではなく「〜している」
- **同じ表を 2 箇所に作らない。** 正となる 1 箇所を決め、ほかは参照リンクにする
- **型名・制御構造・変数名の言い換えをコメントに書かない。** 自明なコメントは要らない
- **長い説明の代わりに `@ref` で参照を出す**

つまり、**表は skill を正**とします。
表を AGENTS.md に転記しません。

`.agents/skills/docs-and-comments/SKILL.md` が正となり、検証用のコマンドもあります。

## 制約

- `.agents/ws/`, `.agents/reports/` などの作業データは **共有しません。**
  必要なら `/tmp/opencode/` を使ってください。
- 秘密情報（トークン・パスワード）を commit しない。
- `AGENTS.md` と `.agents/skills/` だけが git 管理下です。
  `.agents/memory/` はローカル専用の記憶で追跡対象外です。
- `scripts/`、編集用ページ（`routes/exp/`）は commit 対象にしない。

## 実装上の注意

- **`app/bench/**` は `pnpm check` の対象外。** `app/jsconfig.json` の `include` に
  `bench/**/*.ts` を入れていない。include を自分で書くと
  `$env/dynamic/private` が 5 error になるので、必ず `.svelte-kit/ambient.d.ts` ほかを
  列挙し直す
- **次数 1 の端ノードは fold で `MapVCrossNode` 化されてエッジが消える。**
  検証グラフは両端を交差点にする
- **`EnvironmentFile` に `-` を付けない。** ファイルが必須になり、unit が起動しない
