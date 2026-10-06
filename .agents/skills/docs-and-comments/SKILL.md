---
name: docs-and-comments
description: Use when writing or reviewing Markdown documents and code comments: deciding where information belongs (memory vs ドキュメント vs コメント), writing comments, or structuring a README section. Keywords: コメント, documentation, README, ドキュメント, 1文1行, line wrap, 設計判断, 表の重複, 肯定形, comment style.
---

# ドキュメントとコメントの書き方

## 置き場所を決める（最初に必ず問う）

情報の**行き先**を決める。
置き場所は 3 つある。

| 情報 | 置き場所 | 例 |
|---|---|---|
| 作業のための知識（ツールの構文・API の書き方） | `.agents/memory/` | Nix の indented string 内で bash 変数をどう書くか |
| 設計判断（なぜその方式を選んだか） | Markdown | なぜ setup-script で env ファイルを生成するか |
| ロジック（その行が何をするか・なぜ動くか） | コードのコメント | `.git が無い環境では空文字列になる` |

**設計判断をコードコメントに書かない。** コードは「動いている説明」だけを持つ。
**構文の知識をドキュメントに書かない。** 運用者はそれを読まない。`memory_*` に保存する。

## コメント

### ロジックに着目する

文法・構文の説明ではなく、その行が**何をするか**を書く。

```bash
# ❌ 文法に着目（長すぎる）
# 2>/dev/null || true は、.git が無いと rev-parse が失敗して
# set -e でスクリプト全体が止まるのを防ぐため

# ✅ ロジックに着目（1 行）
# .git が無い環境では空文字列になる
```

### 簡潔に

1 行で。
説明したいことがあればドキュメントに書く。

### 自明なコメントは書かない

型名・制御構造・変数名の言い換えは書かない。

### ドキュメントを参照で示す

長い説明の代わりに参照だけを置く。

```ts
/**
 * 起動したビルドの git commit。
 * @ref infra/README.md
 */
```

## ドキュメント（Markdown）

### 1文1行。line wrap しない

折り返さない。
文末の句点で区切って次の行にする。

```markdown
# ❌ 折り返し
デプロイごとに「どのビルドのトレースか」を区別できるようにするためのもので、
`procon-app.service` が `EnvironmentFile` で読み込む。

# ✅ 1文1行
デプロイごとに「どのビルドのトレースか」を区別できるようにするためのものです。
`procon-app.service` が `EnvironmentFile` で読み込みます。
```

**1 行に 2 文以上ないこと。** 検出手順は「検証」を参照。

### 肯定的な文を書く

否定的な説明（〜できない、〜を避ける）よりも、〜している、〜を採用した という肯定形を好む。

```markdown
# ❌ 否定形
Nix の eval は pure eval では組み込み環境変数を読めないため、--impure を付けないと空文字を返す。

# ✅ 肯定形
ハッシュは setup-script が書き出す。
setup-script は root で Git リポジトリを直接扱えるので、そこで記録できる。
```

### 同じ表を 2 箇所に作らない

意味の表は**正となる 1 箇所**に置き、ほかの文書は参照リンクにする。

```markdown
値の意味と生成方法は [`infra/README.md`](../../../infra/README.md#anchor) にまとめてある。
```

### 作業のための知識はドキュメントに載せない

Nix 構文のようなツールの書き方は `memory_*` に保存する。
運用者向けの README に書くと、対象読者に不要な情報になる。

## 検証

### 1文1行のチェック

編集した節で 1 行に 2 文以上ないか確認する。

```bash
python3 - <<'PY'
for f, start, end in [("infra/README.md", 53, 92)]:
    lines = open(f, encoding="utf-8").read().split("\n")[start-1:end]
    bad = [(i, l.strip()) for i, l in enumerate(lines, start)
           if l.strip() and not l.strip().startswith(("|", "#", "```"))
           and l.strip().count("。") >= 2]
    print(f"{f}: {'OK' if not bad else '要修正'}")
    for i, s in bad: print(f"  {i}: {s}")
PY
```

### 文字化け・混入のチェック

日本語を書くときは U+FFFD・ハングル・簡体字・英単語の混入を検査する。

実際のスクリプトは [`scripts/check_mixing.py`](./scripts/check_mixing.py) に置いてある。
正規表現をインラインで書くと、言語名を直接打つことになるので
自分自身のファイルが検出対象になる。
スクリプトは文字コード範囲で表すことで回避している。

```bash
python3 .agents/skills/docs-and-comments/scripts/check_mixing.py <file> [<file> ...]
```

終了コードは指摘があれば 1、なければ 0。
1 文 1 行の違反も同時に検出する。
コードフェンス内と行内コードは除外する。

**正規表現を自分で書くときの注意。**
言語名を実際に打つと、そのファイル自身が常に検出される。
文字コード範囲（`\uAC00-` のような形）で書く。

**この検査だけでは足りない。**
検出器は完璧ではない。技術語のために緩めた結果を見落とすので、
最後は必ず `read` で目視する。

## 落とし穴

- **コードコメントに設計判断を書くと二重管理になる。** 設計を変えたときにコード側が残る。ドキュメントに 1 箇所だけ置く。
- **同じ表を 2 箇所に作ると片方だけ古くなる。** 正とする場所を決めて、ほかは参照にする。
- **否定形で書くと現在の実感が伝えない。** 「〜できない」ではなく「〜している」。
- **構文の罠はドキュメントでなく memory。** 運用者向けの README に書くと、対象読者に不要な情報になる。
