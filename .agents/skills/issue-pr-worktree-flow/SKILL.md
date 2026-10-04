---
name: issue-pr-worktree-flow
description: Use when creating a GitHub Issue or turning one into a PR in this repo: Milestone and Project ("プロコン") assignment with linked items for traceability, naming convention (Type/IssueNum-Desc), branching from origin/main, worktree isolation under /tmp/opencode/procon/wt-<Issue>, AGENTS.md/.agents symlinks for delegated sessions, handoff comment, local CI verification, and push plus PR creation. Trigger keywords: Issue 作成, Milestone 設定, Project 登録, プロコン, Projects v2, Status フィールド, Issue から PR を作る, ブランチ命名規則, worktree 作成, worktree 分離, シンボリックリンク, 引き継ぎメモ, gh pr create, origin/main から分岐, PR 作成手順, CI 確認, worktree 削除.
args: <Issue 番号>
---

# Issue から PR まで

```
Issue  →  PR  →  worktree 分離  →  セッション委任
```

この 4 つが 1 本の線。
どれかを飛ばすと、後工程で取り返しがつかなくなる。
（例: worktree 分離を飛ばすと、委任したセッションが自分の作業ツリーを壊す）

セッション委任の做法は [`opencode-session-delegation`](../opencode-session-delegation/) を参照。

## 前提知識

- **命名規則**: `<Type>/<Issue 番号>-<ShortDesc>`（`Fix/101-BenchCalibration` の形式）
  - `Type` は `Fix` / `Feat` / `Chore` / `Docs`
  - **Issue 番号は必ず入る。** 番号なしは後から読みにくい

- **worktree の置き場所**: `/tmp/opencode/procon/wt-<Issue 番号>`
  リポジトリごとのサブディレクトリを挟むと、複数リポジトリの worktree が混ざらない。
  後始末もリポジトリ単位でできる。

- **base は必ず `origin/main`**。ローカルの `main` は古いので使わない

- **push はユーザーの指示があるまでしない**

## 手順

### Issue の状態を確認する

```bash
gh issue view <N> --json number,title,state,url
```

既に closed / merged なら新しい番号を使う。
PR のマージで自動的に close されることがある。

### Issue を新規に作るときは Milestone と Project を必ず設定する

#### Milestone

| number | タイトル | 用途 |
|---|---|---|
| 1 | 0. 必須機能 | 提出に必要な機能 |
| 3 | 1. 補助機能 | 開発ツール・計測・品質改善 |
| 4 | 2. 書類仕事 | 卒研の書類 |
| 2 | 3. 卒研としてやるやつ | 卒研の自主課題 |

**bench / CI / 計測 / リファクタの類は「1. 補助機能」（number=3）。**

```bash
gh issue edit <N> --milestone "1. 補助機能"
```

迷うのは「0. 必須機能」（提出に要るもの）か
「1. 補助機能」（提出要件ではないもの）で分ける。

#### Project

Project **「プロコン」（owner は viewer、number=2、ID `PVT_kwHOAu9HaM4BdpD9`）** に登録する。
照会にはユーザー名ではなく `viewer` を使う
（`syoch` は Organization ではないため `organization(login:)` だと NOT_FOUND になる）。

`Status` の約束: **OPEN → `Todo` / CLOSED → `Done`**。
`In Progress` は歴史的に使われていないので、`Todo` のまま使う。

```bash
ISSUE_ID=$(gh api graphql -f query='query { repository(owner:"syoch", name:"procon") { issue(number:<N>) { id } } }' \
  --jq '.data.repository.issue.id')
PROJECT_ID="PVT_kwHOAu9HaM4BdpD9"

gh api graphql -f query="mutation { addProjectV2ItemById(input: {projectId: \"$PROJECT_ID\", contentId: \"$ISSUE_ID\"}) { item { id } } }" \
  --jq '.data.addProjectV2ItemById.item.id'
```

Status の設定は GraphQL で行う。
使う前に `gh project field-list 2 --owner syoch` で実際の ID を確認する。

#### PR も Project に登録する

**Issue だけだと PR がどこまで進んだかを確認できない。**
PR も登録し、Issue と PR を行き来できるようにする。

```bash
PR_NODE=$(gh api graphql -f query='query { repository(owner:"syoch", name:"procon") { pullRequest(number:<N>) { id } } }' \
  --jq '.data.repository.pullRequest.id')
gh api graphql -f query="mutation { addProjectV2ItemById(input: {projectId: \"$PROJECT_ID\", contentId: \"$PR_NODE\"}) { item { id } } }" \
  --jq '.data.addProjectV2ItemById.item.id'
```

### ブランチを切って worktree を作る

```bash
git fetch origin
mkdir -p /tmp/opencode/procon
git worktree add -b <Type>/<N>-<ShortDesc> /tmp/opencode/procon/wt-<N> origin/main
```

### worktree を自己完結させる（委任する場合は必須）

`git worktree add` は追跡ファイルしか作らないので、
`AGENTS.md` と `.agents/` は**存在しない**。

```bash
cd /tmp/opencode/procon/wt-<N>
REPO=/home/syoch/ghq/github.com/syoch/procon
ln -sfn "$REPO/AGENTS.md" AGENTS.md
ln -sfn "$REPO/.agents"   .agents
```

**コピではなくシンボリックリンクにする。**
新しいセッションが memory に書いても、メイン側と同一になる（二重管理にならない）。

**ただし `AGENTS.md` と `.agents/skills/` は追跡対象になっている。**
シンボリックリンクを置くと git から見ると「symlink から実ファイルに変わった」扱いになる。

```bash
git status --porcelain   # AGENTS.md と .agents/ が出るのが正しい
```

出ていることを確認して、**それのままにしてよい。**
`git add` しなければ commit には乗らない。

### Issue にコメントして引き継ぎを残す

セッションを跨ぐなら必須。
Issue が「何をするか」だけだと、新しいセッションは合意の経緯を再構築できない。

- 合意した決定（Q1 から Q4 の答え）
- 現状のコード（変更前に把握しておくべき構造）
- 実装順の目安
- 検証方法
- スコープ外の事項

### 実装する（worktree 内で）

編集の做法は [`AGENTS.md`](../../../AGENTS.md) にまとめてある。

### 検証して commit する

```bash
cd /tmp/opencode/procon/wt-<N>/app
nix develop --command pnpm check     # 型検査
nix develop --command pnpm test      # vitest
```

`node` や `python3` は `nix develop` 経由でないと入っていない。

```bash
cd /tmp/opencode/procon/wt-<N>
git add -A
git commit -F <message file>
```

コミットメッセージは heredoc で直接書かず、ファイルに書いて `-F` で渡す。
直接書くと文字の混入が起き、あとから修正が必要になる。

### push して PR を作る

```bash
git push -u origin <Type>/<N>-<ShortDesc>
gh pr create --base main --head <Type>/<N>-<ShortDesc> \
  --title "..." --body-file <body file>
```

PR 本文には**検証結果**（実行したコマンドと実測値）を入れる。
記憶の中の数値ではなく、実際に実行した出力を貼る。

### CI を確認して報告する

```bash
gh pr checks <N>
gh run view --log     # 失敗したときの実際のログ
```

**bench ジョブのログは実際の挙動を証拠として読む。**
比較が成立したのかを `::error::` / `::warning::` / `::notice::` で区別する。

## 落とし穴

- **`rm -rf` で作業ツリーを消さない。** `git worktree remove` を使う

- **`git branch backup/x` は push しない。** ローカルにだけ存在する

- **worktree に `AGENTS.md` と `.agents/` が無いことに気づかない。**
  上の手順で対処する。委任する場合は必須

- **シンボリックリンクを置くと `git status` に出る。**
  追跡対象になったためで、`git add` しなければ commit には乗らない

- **base が古くないか作業開始前に確認する。**
  `git merge-base --is-ancestor origin/main HEAD` が false なら rebase
  （squash merge 後遺のチェックは `stacked-pr-rebase` を参照）

- **`Co-Authored-By` trailer を勝手に入れてはいけない。**
  ユーザーが求めていない attribution を書くと履歴に残り、後始末が必要になる。
  `git config` と commit template が無いことを確認してから（無ければ入れない）

- **`--force` ではなく `--force-with-lease`。** rebase 後は必ず

- **既に merge 済みの Issue から新規ブランチを始めない。** 先に `gh issue view` する

- **言語の混入**（ハングル・簡体字・英単語）が日本語文に入ると、
  値が壊れても気づけない。書き終えたら
  [`docs-and-comments`](../docs-and-comments/) のチェッカーでスキャンする

- **`edit` や `write` で skill や SKILL.md を上書きすると frontmatter を失う。**
  frontmatter 付きのファイルは `agents_update` を使う

- **生成した PR body をそのまま使わない。** 実際の内容を読んでから push する

## 検証

- PR が `open` で、head / base が意図したブランチ

- CI が全て green（意図的に赤にした場合はその理由を本文に残す）

- Issue と PR の両方が Project に登録されている

- Issue に実装メモが残っている（セッションを跨いだ場合）

- Resolve Conversation したコメントが、対応した変更に対応している

- 不要になった worktree が整理されている

## 関連

- セッション委任の做法は [`opencode-session-delegation`](../opencode-session-delegation/) を参照

- stacked PR の base 変更・吸収判断は `stacked-pr-rebase` を参照

- 小さな修正を別ブランチで作る場合は `worktree-fix-merge-cycle` を参照

- インラインコメントでのレビューは `gh-pr-inline-review` を参照

- セッションのアーカイブと削除は `session-archive-workflow` を参照

- 文書とコメントの書き方は [`docs-and-comments`](../docs-and-comments/) を参照