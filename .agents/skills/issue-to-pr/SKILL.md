---
name: issue-to-pr
description: Use when turning a GitHub Issue into a merged PR in this repo: Milestone and Project ("プロコン") assignment for both Issue and PR, naming convention (Type/IssueNum-Desc), branching from origin/main, worktree isolation under /tmp/opencode/procon/wt-<Issue>, sharing .agents/memory with the main worktree for delegated sessions, handoff comment, delegation via the session-delegation skill, local CI verification, push, PR creation, and resolving review threads. Trigger keywords: Issue 作成, Milestone 設定, Project 登録, プロコン, Projects v2, Status フィールド, Issue から PR を作る, ブランチ命名規則, worktree 作成, worktree 分離, シンボリックリンク, 引き継ぎメモ, gh pr create, origin/main から分岐, PR 作成手順, CI 確認, worktree 削除, セッション委任, Resolve Conversation.
args: <Issue 番号>
---

# Issue から PR まで

```
Issue  →  PR  →  worktree 分離  →  セッション委任  →  Resolve Conversation
```

この 5 つが 1 本の線。
どれかを飛ばすと、後工程で取り返しがつかなくなる。
（例: worktree 分離を飛ばすと、委任したセッションが自分の作業ツリーを壊す）

セッション委任の方法は global skill の `session-delegation` を参照。
インラインコメントと Resolve Conversation は `gh-pr-inline-review` を参照。

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

### ブランチを切って worktree を作る

```bash
git fetch origin
mkdir -p /tmp/opencode/procon
git worktree add -b <Type>/<N>-<ShortDesc> /tmp/opencode/procon/wt-<N> origin/main
```

### memory を共有する（委任する場合のみ）

`AGENTS.md` と `.agents/skills/` は追跡対象なので、
`git worktree add` で既に作業ツリーに入る。
**シンボリックリンクは作らない。**
無いのは `.agents/memory` だけ。
これは `.git/info/exclude` で除外しているので clone されない。

```bash
cd /tmp/opencode/procon/wt-<N>
mkdir -p .agents
ln -sfn /home/syoch/ghq/github.com/syoch/procon/.agents/memory .agents/memory
```

**コピではなくシンボリックリンクにする。**
新しいセッションが `memory_save` してもメイン側と同一になる（二重管理にならない）。

コピにすると、メイン側で memory を更新しても作業ツリー側は古いままになる。

**`git status` に `?? .agents/memory` が出るのは正しい。**
除外しているのはメイン作業ツリー側の `.git/info/exclude` なので、
作業ツリーでは未追跡として出る。
`git add` しなければ commit には乗らない。
**この PR のマージ前は `AGENTS.md` が無い。**
その作業ツリーで他の作業を始めると `AGENTS.md` が見つからないので、
先に Issue #107 を merge する。

### Issue にコメントして引き継ぎを残す

セッションを跨ぐなら必須。
Issue が「何をするか」だけだと、新しいセッションは合意の経緯を再構築できない。

- 合意した決定（Q1 から Q4 の答え）
- 現状のコード（変更前に把握しておくべき構造）
- 実装順の目安
- 検証方法
- スコープ外の事項

### 実装する（worktree 内で）

編集の方法は [`AGENTS.md`](../../../AGENTS.md) にまとめてある。

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

### レビューコメントを Resolve Conversation する

対応内容を返信してから resolve する。
順序を逆にすると変更していないコメント解決扱いになる。

```bash
# 1. 未解決のスレッドを確認
gh api graphql -f query='
query { repository(owner:"syoch", name:"procon") { pullRequest(number:<N>) { reviewThreads(first:100) {
  nodes { id isResolved isOutdated path line comments(first:1){ nodes { databaseId } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved==false))'

# 2. 1 件ずつ、返信してから resolve
gh api repos/syoch/procon/pulls/<N>/comments/<databaseId>/replies -f body="対応しました。..."
gh api graphql -f query='
mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }' \
  -f id="<PRRT_kwDO...>"
```

投稿と resolve の手順は `gh-pr-inline-review` を参照。

### セッションに委任する（長い作業の場合）

1 セッション 1 作業を原則にする。
自分でループを全て抱えるとコンテキストが潰れる。

方法の詳細は global skill `session-delegation` を参照。
このリポジトリでの用法だけ以下に書く。

```bash
python3 ~/.agents/skills/opencode/session-delegation/scripts/delegate.py \
  --worktree /tmp/opencode/procon/wt-<N> \
  --title "<作業名>" \
  --prompt-file /tmp/opencode/procon/prompts/<file>.md \
  --log /tmp/opencode/procon/logs/<name>.log
```

**委任したら監視しない。** 完了通知を送らせて、向こうが次の作業へ進む。

#### マーカーの形式

通知は JSON ファイル 1 個で渡す。
フィールドは 4 つで、全部省略できる。

| キー | 内容 |
|---|---|
| `summary` | やったことを 1 行で |
| `checks` | 検証した項目のリスト |
| `notes` | 判断の根拠や、意図的に直さなかったもの |
| `branch` / `pr` / `ci` | 末尾に機械的に付く識別情報 |

```json
{
  "summary": "校正ゲートの計測順バイアスを直した",
  "checks": ["校正の比が 0.94x になった", "回帰判定が動いている"],
  "notes": ["案 D と E は不採用。理由と根拠をコメントに残した"],
  "branch": "Chore/104-BenchIdCompare",
  "pr": "https://github.com/syoch/procon/pull/105",
  "ci": "bench / check / test / build すべて pass"
}
```

`summary` だけだと次の作業を決められないので、
`checks` と `notes` を書いておく。

#### 通知の実行

**委任先のセッションが**、作業を終えたタイミングで実行する。
委任した側が実行するのではない。

```bash
python3 ~/.agents/skills/opencode/session-delegation/scripts/delegate.py \
  --notify-done <宛先のセッションID> /tmp/opencode/procon/done-<something>.json
```

宛先のセッション ID は、`--session` で求めたものと一致する。
つまり自分（委任した側）のセッション ID を渡す。

```bash
python3 ~/.agents/skills/opencode/session-delegation/scripts/session_state.py \
  <宛先のセッションID> /tmp/opencode/procon/wt-<N>
```

表示された `session:` の行に ID が出る。

#### 実行するタイミング

**push と commit のあとに実行する。**
通知を受けて次の作業へ進むのは、待つ側の判断なので、
成果が/git に入っていないと参照できない。

マーカーは先に書ける。
送信に失敗してもファイルは残るので、あとから送れる。

#### 失敗したとき

応答を待つので、成功したかどうかが分かる。

```bash
OK: <セッションID> に通知しました（<文字数> 文字>
ERROR: <理由>
```

`--notify-done` はループを持たないので、落ちても他の作業に影響しない。

`ERROR` が出たときは、`delegate.py` の出力とマーカーの中身をそのまま、
完了報告に一緒に伝えてください。

### プロンプトに書くこと

- **触ってはいけないファイルを明示する。**
  他の PR の作業中だとシンボリックリンク経由で巻き込むので、
  `AGENTS.md` と `.agents/` を対象として指定する
- **「push 後の作業」までやるよう指示する。**
  Resolve Conversation と報告まで含める
- 規約を明記する（言語混入スキャン、Markdown の書き方）
- **途中で止めないことを明示する**

### 稼働を確認したいとき

```bash
python3 ~/.agents/skills/opencode/session-delegation/scripts/session_state.py \
  <セッションID> /tmp/opencode/procon/wt-<N>
```

**1 回の観測で停止と判断しない。** コールドスタートの空白は区別できない。

## 落とし穴

- **`rm -rf` で作業ツリーを消さない。** `git worktree remove` を使う

- **`git branch backup/x` は push しない。** ローカルにだけ存在する

- **`AGENTS.md` と `.agents/skills/` は最初から入っている。**
  追跡対象なので `git worktree add` で入る。シンボリックリンクを作ると衝突する

- **`.agents/memory` だけは無い。** git 管理対象外なので、
  委任するときはシンボリックリンクで結ぶ

- **`?? .agents/memory` が出ても commit しない。**
  除外しているのはメイン作業ツリー側の `.git/info/exclude` なので、
  作業ツリーでは未追跡になる

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

- Issue が Project に登録されている

- Issue に実装メモが残っている（セッションを跨いだ場合）

- Resolve Conversation したコメントが、対応した変更に対応している

- 不要になった worktree が整理されている
## 関連

global skill は名前だけで参照する（実体は `~/.agents/skills/<category>/<name>/`）。

- セッション委任の方法は `session-delegation` を参照
- インラインコメントと Resolve Conversation は `gh-pr-inline-review` を参照
- stacked PR の base 変更・吸収判断は `stacked-pr-rebase` を参照
- 小さな修正を別ブランチで作る場合は `worktree-fix-merge-cycle` を参照
- セッションのアーカイブと削除は `session-archive-workflow` を参照

project skill は相対リンクで参照する。

- 文書とコメントの書き方は [`docs-and-comments`](../docs-and-comments/) を参照
