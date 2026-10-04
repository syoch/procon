#!/usr/bin/env python3
"""日本語の混入チェッカー。

U+FFFD・ハングル・キリル文字と、1 行 1 行ルールの違反を検出する。
コードフェンス内と行内コードは、検出例を載せていることがあるので除外する。

使い方:
    python3 check_mixing.py <file> [<file> ...]

終了コード:
    0  指摘なし
    1  指摘あり
"""
import pathlib
import re
import sys

# コードフェンスを除外しながら行単位で見る
FENCE = re.compile(r"^\s*```")
INLINE_CODE = re.compile(r"`[^`]*`")

# 言語を文字コード範囲で表す。言語名を実際に打つと、このファイル自身が検出対象になる。
HANGUL = re.compile("[\\uAC00-\\uD7AF\\u1100-\\u11FF\\u3130-\\u318F]")
CYRILLIC = re.compile("[\\u0400-\\u04FF]")

# 1 行 1 行ルールで「2 文以上」になるしきい値
TWO_SENTENCES = 2

# 1 文 1 行ルールの対象外にする行頭記号。
# 既存資料（docs/設計/06 など）も箇条書きは複合文を 1 行にまとめている。
SKIP_PREFIX = ("|", "#", ">", "-", "*", "\t")

# スクリプト自身は文字列リテラルに「。」を含むので、1 文 1 行の検査だけ外す
SKIP_ONE_SENTENCE_SUFFIX = (".py", ".mjs", ".js", ".ts")
ORDERED = re.compile(r"^\d+\.\s")

EXIT_OK = 0
EXIT_FINDINGS = 1


def read_lines(path):
    return pathlib.Path(path).read_text(encoding="utf-8").split("\n")


def check_replacement_char(path):
    raw = pathlib.Path(path).read_bytes()
    if b"\xef\xbf\xbd" in raw:
        print(f"[REPLACEMENT] {path}")
        return True
    return False


def check_mixing(path):
    findings = []
    in_fence = False
    for i, line in enumerate(read_lines(path), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        outside = INLINE_CODE.sub("", line)
        for name, pattern in (("HANGUL", HANGUL), ("CYRILLIC", CYRILLIC)):
            if pattern.search(outside):
                findings.append((i, name, outside.strip()[:70]))
    return findings


def check_one_sentence(path):
    findings = []
    in_fence = False
    for i, line in enumerate(read_lines(path), 1):
        stripped = line.strip()
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or not stripped:
            continue
        if stripped.startswith(SKIP_PREFIX) or ORDERED.match(stripped):
            continue
        if path.endswith(SKIP_ONE_SENTENCE_SUFFIX):
            continue
        body = INLINE_CODE.sub("", stripped)
        if body.count("。") >= TWO_SENTENCES:
            findings.append((i, "TWO-SENTENCES", stripped[:70]))
    return findings


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return EXIT_FINDINGS
    rc = EXIT_OK
    for path in sys.argv[1:]:
        found = check_replacement_char(path)
        for i, kind, text in check_mixing(path) + check_one_sentence(path):
            print(f"[{kind}] {path}:{i} {text}")
            found = True
        if found:
            rc = EXIT_FINDINGS
    print("OK" if rc == EXIT_OK else "要修正")
    return rc


if __name__ == "__main__":
    sys.exit(main())