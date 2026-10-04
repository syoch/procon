---
name: opencode-session-delegation
description: Use when delegating work to another OpenCode session via the Web API, or when a delegated session appears stalled: correct request body (nested model), systemd opencode.service on port 12000, session creation scoped by directory, prompt_async for fire-and-forget, background launch with nohup, cold-start non-determinism, completion polling, and completion callbacks back to the parent session. Trigger keywords: OpenCode Web API, opencode serve, opencode.service, セッション委任, 委任, delegate, prompt_async, noReply, fire-and-forget, バックグラウンド起動, コールドスタート, 応答が来ない, セッション起動, nohup, 12000.
args: <worktree パス> <プロンプトファイル>
---

# OpenCode Web API でセッションを委任する
このセッションのコンテキストを跨いで作業を任せる場合の做法。
`issue-pr-worktree-flow` の Delegation から使う。

## サーバーは正規のものを使う

`opencode.service`（systemd user サービス、port 12000）が正規。

```bash
systemctl --user is-active opencode.service
curl -s -o /dev/null -w "%{http_code}" http://localhost:12000/session
```

**Ad-hoc で `opencode serve --port <port>` を起こさない。**
2 つ立つと混乱するうえ、認証情報の更新を取りこぼす。

## 仕様を確認する

何かがおかしいときは OpenAPI 仕様を見ます。

- 仕様: <https://opencode.ai/docs/server/>
- ローカルに''.

**今は opencode v1 を使っている。**
v2 のドキュメントを参照すると書式が違うので、
getting started やセッション周りは v1 の API とは一致しないことがあります。

```bash
curl -s http://localhost:12000/doc | python3 -m json.tool | less
```

## 依頼スクリプトを使う

必要な情報を受け取って委任するスクリプトを用意している。
手で curl を組み立てるよりこれを使うほうが早く、書き間違えない。

```bash
python3 .agents/skills/opencode-session-delegation/scripts/delegate.py \
  --worktree /tmp/opencode/procon/wt-<Issue 番号> \
  --title "<作業名>" \
  --prompt-file /tmp/opencode/procon/prompt-<something>.md \
  --log /tmp/opencode/procon/agent-<Issue 番号>.log
```

スクリプトは次能做到:

- ディレクトリ指定でセッションを作る
- プロンプトを送る（`--wait` を付けると応答まで待つ）
- バックグラウンドで起動する（`nohup`）
- 完了通知のスクリプトの使い方を，表示する

## リクエストの形式（ここを間違えると永久にハングする）

**`providerID` / `modelID` はトップレベルに置かない。** `model` にネストする。

```
誤:  { "parts": [...], "providerID": "...", "modelID": "..." }
正:  { "parts": [...], "model": { "providerID": "...", "modelID": "..." } }
```

スキーマが `additionalProperties: false` なので上のは**不正な body** になり、
assistant メッセージが作られる（parts は 0）まま **run が一切始まらない**。
POST は完了しないまま返ってこない。
プロバイダを切り替えても直らない。
形式に迷ったら OpenAPI 仕様を確認する。

### `prompt_async` を使う

応答を待たずに投げ込むなら `POST /session/<ID>/prompt_async` を使う。

`noReply: true` は「返信を生成しない」の意味であり、**run が始まらない**。
fire-and-forget のフラグではない。
バックグラウンド化はプロセス側で行う。
```bash
curl -s -X POST "http://localhost:12000/session/<ID>/prompt_async?directory=<worktree>" \
  -H 'content-type: application/json' \
  -d '{"model":{"providerID":"...","modelID":"..."},"parts":[{"type":"text","text":"..."}]}'
```

## 「停止」と判断するのをやめる（最重要）

起動直後は**次の状態が普通に出る**。

```
メッセージ数: 2（user 1 + assistant 1）
assistant の parts: 0
/session/status: {}
```

**これはコールドスタートの空白で、停止ではない。**
そのまま応答が返るので、待てばそのうち結果が来る。
判定基準:

- メッセージ数・parts・`/session/status`・**ファイル変更**を**複数回**確認する
- 1 回の観測で「止まった」と言わない
- コールドスタートは**非決定的**。同じプロンプトで成功と timeout が両方起こる
  （実測で 500 文字が timeout、1000 から 6000 文字が成功した例あり。サイズが原因ではない）

## POST は完了までブロックする

応答が返るまで処理が続くので、**バックグラウンドプロセスとして起動する**。

```bash
nohup python3 delegate.py ... > /tmp/opencode/procon/agent-<N>.log 2>&1 &
```

これで元のセッションを閉じて作業を進められる。

## 監視しない。呼び戻させる

**完了を待つためにポーリングしない。**
委任先のセッションから自分へ完了通知を送らせる。
待つ側は何もしなくてよいです。
通知が届いたら次の作業に移ります。
```bash
# 委任先のセッションで、完了時にこれを実行する
python3 .agents/skills/opencode-session-delegation/scripts/delegate.py \
  --notify-done <宛先セッションID> /tmp/opencode/procon/done-<something>.json
```

マーカー JSON には `summary` と `checks` を書く。
`<宛先>` 側のセッションに完了内容が届くので、向こうが次の作業へ進める。

通知が失敗しても成果は失われない。
マーカーファイルが残っていれば後から送れるので、**push と commit のあとに**書く。

### ポーリングが自己デッドロックする

**待つために `pgrep` や `sleep` のループを書かない。**
実際にハングして、成果が出ていない例があります。

```bash
# ❌ 永久に終わらない。pgrep が自分のコマンドラインにもマッチする
for i in $(seq 1 10); do
  sleep 60
  if ! pgrep -f send_prompt2.py >/dev/null; then break; fi
done
```

`pgrep -f` は**自分自身のコマンドライン**にもマッチする。
上のループは `pgrep` が自分自身を見つけ続けるので `break` に到達せず、
10 分間 `sleep` するだけでした。
成果は何も進んでいませんでした。

プロセスは目印にすぎない。
サーバに問い合わせます。
python3 .agents/skills/opencode-session-delegation/scripts/session_state.py \
  <セッションID> /tmp/opencode/procon/wt-<Issue 番号>
```

判定材料:

| 出力 | 意味 |
|---|---|
| 実行中のツールがある | 動いている |
| ツール 0 個 / 完了あり | 一段落している |
| `/session/status` が空 | 動いているセッションが無い |
| サーバーが応答しない | opencode.service を確認する |

**1 回の観測で「停止」と判断しない。** コールドスタートの空白はこれと区別できない。

通知の仕組みは `delegate.py --notify-done` を使う。
これは監視ではなく呼び戻しなので、待つ側に負担がない。

## プロンプトに書くこと

- 計画はファイルに書いて、本文を埋め込む
- 規約を明記する（言語混入スキャン、`Co-Authored-By` 禁止、Markdown の書き方）
- **「push 後の作業」までやるよう指示する**（Resolve Conversation、報告）
- 途中で止めないことを明示する
- **触ってはいけないファイルを明示する。**
  他の PR の作業中だと symlink 経由で巻き込むので、
  `AGENTS.md` と `.agents/` などの対象を指定する

## 完了の確認方法

| 手段 | 確認できるもの |
|---|---|
| 完了通知 | 委任先からの報告 |
| `gh pr checks <N>` | 最終結果 |
| `http://localhost:12000` でセッションを開く | 進捗と内容 |
| ログファイル | バックグラウンドの返回值 |

## Resolve Conversation する

完了後にインラインコメントを resolve する。

opencode の API に無いので `gh api` の GraphQL を使う。
thread ID は review comment の `node_id` から取る。

```bash
gh api repos/syoch/procon/pulls/<N>/comments \
  --jq '.[] | "\(.node_id) \(.id) \(.path):\(.line // .original_line)"'

gh api graphql -f query='
mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }' \
  -f id="<PRRT_kwDO...>"
```

**1 件ずつ、該当箇所の変更が済んでから resolve する。**
各コメントには対応内容を返信する。

## 落とし穴

- **不正な body はハングする。** プロバイダを切り替えても直らない
- **`noReply: true` は run を起動しない。**
- **1 回の観測で「停止」と言わない。** コールドスタートは非決定的
- **`pgrep` / `sleep` のループで待たない。** 上の「ポーリングが自己デッドロックする」を読む
- **通知は 1 回だけ。** 作業中に繰り返さない
- **`AGENTS.md` と `.agents/` を共有すると巻き込む。**
  他の作業と併存するときは相手側の作業と衝突する。
- **`git commit --amend` と `git push --force` を委任しない。**
  安易な force push は他人の作業を打ち消す。
## 関連

- Issue から PR までの一連の流れは `issue-pr-worktree-flow` を参照
- セッションのアーカイブと削除は `session-archive-workflow` を参照
- インラインコメントの投稿は `gh-pr-inline-review` を参照