---
name: issue-pr-worktree-flow
description: Use when creating a GitHub Issue or turning one into a PR in this repo: Milestone and Project ("プロコン") assignment, naming convention (Type/IssueNum-Desc), branching from origin/main, worktree isolation with AGENTS.md/.agents symlinks, handoff comment, local CI verification, push and PR creation, and launching a separate session via the OpenCode Web API (opencode.service port 12000, correct request body, background launch, cold-start non-determinism, Resolve Conversation). Trigger keywords: Issue 作成, Milestone 設定, Project 登録, プロコン, Projects v2, Status フィールド, Issue から PR を作る, ブランチ命名規則, worktree 作成, worktree 分離, シンボリックリンク, 引き継ぎメモ, gh pr create, origin/main から分岐, OpenCode Web API, opencode serve, noReply, fire-and-forget, バックグラウンド起動, セッション委任, Resolve Conversation, PR 作成手順, CI 確認, worktree 削除.
args: &lt;Issue 番号&gt;
---

## 軸

```
Issue  →  PR  →  worktree 分離  →  OpenCode Web API でセッション起動
```

この 4 つが 1 本の線。どれかを飛ばすと、後工程で contorno Crusoe 作業になる
（例: worktree 分離を飛ばすと、委任したセッションが自分の作業ツリーを壊す）。

## 前提知識

- **命名規則**: `<Type>/<Issue 番号>-<ShortDesc>`（`Fix/101-BenchCalibration` の形式）
  - `Type` は `Fix` / `Feat` / `Chore` / `Docs`
  - **Issue 番号は必ず入る**。番号なし（`Fix/bench-gate-harness-drift` のような形）は後から読みにくい
- **worktree の置き場所**: `/tmp/opencode/wt-<Issue 番号>`
- **base は必ず `origin/main`**。ローカルの `main` は古いので使わない
- **push はユーザーの指示があるまでしない**

## 手順

### 1. Issue の状態を確認する

```bash
gh issue view <N> --json number,title,state,url
```

既に closed / merged なら新しい番号を使う。PR のマージで自動的に close されることがある。

### 2. Issue を新規に作るときは Milestone と Project を必ず設定する

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

迷うのは「0. 必須機能」（提出に要るもの）か「1. 補助機能」
（提出要件ではないもの）で分ける。

#### Project

Project **「プロコン」（owner は viewer、number=2、ID `PVT_kwHOAu9HaM4BdpD9`）** に登録する。
照会にはユーザー名ではなく `viewer` を使う（`syoch` は Organization ではないため
`organization(login:)` だと NOT_FOUND になる）。

`Status` の約束: **OPEN → `Todo` / CLOSED → `Done`**。
`In Progress` は歴史的に使われていないので、`Todo` のまま使う。

```bash
ISSUE_ID=$(gh api graphql -f query='query { repository(owner:"syoch", name:"procon") { issue(number:<N>) { id } } }' --jq '.data.repository.issue.id')
PROJECT_ID="PVT_kwHOAu9HaM4BdpD9"

gh api graphql -f query="mutation { addProjectV2ItemById(input: {projectId: \"$PROJECT_ID\", contentId: \"$ISSUE_ID\"}) { item { id } } }" --jq '.data.addProjectV2ItemById.item.id'
```

Status の設定は GraphQL で行う。

```bash
FIELD_ID=$(gh api graphql -f query='...select(.name=="Status") | .id' --jq ...)
OPTION_ID=$(gh api graphql -f query='...select(.name=="Todo") | .id' --jq ...)
gh api graphql -f query="mutation { updateProjectV2ItemFieldValue(input: {projectId: \"$PROJECT_ID\", itemId: \"<ITEM_ID>\", fieldId: \"$FIELD_ID\", value: {singleSelectOptionId: \"$OPTION_ID\"}}) { projectV2Item { id } } }"
```

#### このリポジトリの実際の ID（2026-10-04 確認）

上の GraphQL クエリで取り出せる。ただし Status の Option は並びと ID が変わる
可能性があるため、**使う前に `gh project field-list` で必ず確認すること**。

| 名前 | ID |
|---|---|
| Project | `PVT_kwHOAu9HaM4BdpD9`（number=2、owner は viewer） |
| Status field | `PVTSSF_lAHOAu9HaM4BdpD9zhYJLtg` |
| option `Todo` | `f75ad846` |
| option `In Progress` | `47fc9ee4` |
| option `Done` | `98236657` |

`gh project item-edit` を使う場合は field-id に Status field を、
single-select-option-id に `f75ad846`（Todo）を渡す。

Project ID をハードコードしてよいのは 1 つしかないため。増えたときは
`viewer { projectsV2 }` で列挙する。

### 3. ブランチを切って worktree を作る

```bash
git fetch origin
git worktree add -b <Type>/<N>-<ShortDesc> /tmp/opencode/wt-<N> origin/main
```

### 4. worktree を自己完結させる（委任する場合は必須）

`git worktree add` は追跡ファイルしか作らないので、`AGENTS.md` と `.agents/` は
**存在しない**。`.agents/skills/` を読み損ねると規約を守らない実装になる。

```bash
cd /tmp/opencode/wt-<N>
REPO=/home/syoch/ghq/github.com/syoch/procon
ln -sfn "$REPO/AGENTS.md" AGENTS.md
ln -sfn "$REPO/.agents"   .agents
```

**コピではなくシンボリックリンクにする。** 新しいセッションが `memory_save` しても
メイン側と同一になる（二重管理にならない）。

両方とも `.git/info/exclude`（`.agents` と `AGENTS.md` の行）済みなので
**`git status` は汚れない**。確認する。

### 5. Issue にコメントして引き継ぎを残す

セッションを跨ぐなら必須。Issue が「何をするか」だけだと、
新しいセッションは合意の経緯を再構築できない。

- 合意した決定（Q1〜Q4 の答え）
- 現状のコード（変更前に把握しておくべき構造）
- 実装順の目安
- 検証方法
- スコープ外の事項

### 6. 実装する（worktree 内で）

通常のファイル編集は `edit` ツールを使う。大規模・機械的な編集だけ CLI や Python を使う。

### 7. 検証して commit する

```bash
cd /tmp/opencode/wt-<N>/app
nix develop --command pnpm check     # 型チェック
nix develop --command pnpm test      # vitest
```

`node` や `python3` は `nix develop` 経由でないと入っていない。

```bash
cd /tmp/opencode/wt-<N>
git add -A
git commit -F <message file>
```

コミットメッセージは heredoc で直接書かず、ファイルに書いて `-F` で渡す。
直接書くと文字の混入が起き、あとから修正が必要になる。

### 8. push して PR を作る

```bash
git push -u origin <Type>/<N>-<ShortDesc>
gh pr create --base main --head <Type>/<N>-<ShortDesc> \
  --title "..." --body-file <body file>
```

PR 本文には**検証結果**（実行したコマンドと実測値）を入れる。
記憶の中の数値ではなく、実際に実行した出力を貼る。

### 9. CI を確認して報告する

```bash
gh pr checks <N>
gh run view --log     # 失敗したときの実際のログ
```

**bench ジョブのログは実際の挙動を証拠として読む。**
比較が成立したのかしないのかを、`::error::` / `::warning::` / `::notice::` で区別する。

## OpenCode Web API でセッションを起動する（委任する場合）

### サーバーは正規のものを使う

`opencode.service`（`opencode web --port 12000`、systemd user サービス）が正規。

```bash
systemctl --user status opencode.service --no-pager
```

**Ad-hoc で `opencode serve --port <port>` を起こさない。**
2 つ立つと混乱するうえ、認証情報の更新を取りこぼす。

### 手順

```python
# 1. セッションを作る（worktree をルートにする）
POST /session?directory=/tmp/opencode/wt-<N>
body: { "title": "<作業名>" }

# 2. 計画全文をプロンプトにして送る
POST /session/<ID>/message?directory=/tmp/opencode/wt-<N>
body: {
  "parts": [{ "type": "text", "text": "<計画全文>" }],
  "model": { "providerID": "opencode-go", "modelID": "space-bunny-free" }
}
```

### リクエストの形式（ここを間違えると永久にハングする）

**`providerID` / `modelID` はトップレベルに置かない。** `model` にネストする。

```
誤:  { "parts": [...], "providerID": "...", "modelID": "..." }
正:  { "parts": [...], "model": { "providerID": "...", "modelID": "..." } }
```

スキーマが `additionalProperties: false` なので、上のは**不正な body** になり、
assistant メッセージが作られる（parts は 0）まま **run が一切始まらない**。
POST は完了しないまま返ってこない。プロバイダを切り替えても直らない。

**形式に迷ったら OpenAPI 仕様を確認する。**

```bash
curl -s http://127.0.0.1:12000/doc | python3 -m json.tool | less
```

### `noReply: true` は使わない

「返信を生成しない」の意味であり、**run が始まらない**。
fire-and-forget のフラグではない。バックグラウンド化はプロセス側で行う。

### POST は完了までブロックする

応答が返るまで処理が続くので、**バックグラウンドプロセスとして起動する**。

```bash
nohup python3 launch_agent.py > /tmp/opencode/agent-<N>.log 2>&1 &
```

これで元のセッションを閉じて作業を進められる。

### 「停止」と判断するのをやめる（最重要）

起動直後は**aments 常态がこうなる**。

```
メッセージ数: 2（user 1 + assistant 1）
assistant の parts: 0
/session/status: {}
```

**これはコールドスタートの空白で、停止ではない。** そのまま trusted 応答が返る。

判定基準:

- メッセージ数・parts・`/session/status`・**ファイル変更**を**複数回**確認する
- 1 回の観測で「止まった」と言わない
- コールドスタートは**非決定的**。同じプロンプトで成功と timeout が両方起こる
  （実測で 500 文字が timeout、1000〜6000 文字が成功した例あり。サイズが原因ではない）

### プロンプトに書くこと

- 計画はファイルに書いて、本文を埋め込む
- 規約を明記する（言語混入スキャン、`Co-Authored-By` 禁止、Markdown の書き方）
- **「push 後の作業」までやるよう指示する**（Resolve Conversation、報告）
- 途中で止めないことを明示する

### 完了の確認方法

| 手段 | 確認できるもの |
|---|---|
| `gh pr checks <N>` | 最終結果 |
| `http://localhost:12000` でセッションを開く | 進捗と内容 |
| `/tmp/opencode/agent-<N>.log` | バックグラウンドの返回值 |

### 完了後に Resolve Conversation する

opencode の API に無いので `gh api` の GraphQL を使う。
thread ID は review comment の `node_id` から取る。

```bash
gh api repos/syoch/procon/pulls/<N>/comments --jq '.[] | "\(.node_id) \(.id) \(.path):\(.line // .original_line)"'

gh api graphql -f query='
mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }' -f id="<PRRT_kwDO...>"
```

**1 件ずつ、該当箇所の変更が済んでから resolve する。**
各コメントには対応内容を返信する。

## 落とし穴

- **`rm -rf` で作業ツリーを消さない。** `git worktree remove` を使う
- **`git branch backup/x` は push しない。** ローカルにだけ存在する
- **worktree に `AGENTS.md` と `.agents/` が無いことに気づかない。** 手順 4 で対処する
- **base が古くないか作業開始前に確認する。**
  `git merge-base --is-ancestor origin/main HEAD` が false なら rebase
  （squash merge 後遺のチェックは `stacked-pr-rebase` を参照）
- **`Co-Authored-By` trailer を勝手に入れてはいけない。** ユーザーが求めていない
  attribution を書くと履歴に残り、後始末が必要になる。
  `git config` と commit template が無いことを確認してから（無ければ入れない）
- **`--force` ではなく `--force-with-lease`。** rebase 後は必ず
- **既に merge 済みの Issue から新規ブランチを始めない。** 先に `gh issue view` する
- **言語の混入**（ハングル・簡体字・英単語）が日本語文に入ると、値が壊れても気づけない。
  書き終えたらスクリプトでスキャンする
- **`edit` や `write` で skill や SKILL.md を上書きすると frontmatter を失う。**
  frontmatter 付きのファイルは `agents_update` を使う
- **生成した PR body をそのまま使わない。** 実際の内容を読んでから push する

## 検証

- PR が `open` で、head / base が意図したブランチ
- CI が全て green（意図的に赤にした場合はその理由を本文に残す）
- Issue に実装メモが残っている（セッションを跨いだ場合）
- Resolve Conversation したコメントが、対応した変更に対応している
- 不要になった worktree が整理されている

## 関連

- stacked PR の base 変更・吸収判断は `stacked-pr-rebase` を参照
- 小さな修正を別ブランチで作る場合は `worktree-fix-merge-cycle` を参照
- インラインコメントでのレビューは `gh-pr-inline-review` を参照
- セッションのアーカイブと削除は `session-archive-workflow` を参照
