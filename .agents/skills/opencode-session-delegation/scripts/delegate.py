#!/usr/bin/env python3
"""OpenCode Web API に作業を委任する。

セッションを作ってプロンプトを送り、完了通知の受け取り方も用意する。

# 委任する（バックグラウンドで起動する）
    python3 delegate.py --worktree <worktree> --title <作業名> \\
        --prompt-file <plan.md> --log <log>

# 応答まで待って結果を受け取る
    python3 delegate.py --worktree <worktree> --title <作業名> \\
        --prompt-file <plan.md> --wait

# 既存のセッション ID に直接送る（レビュー依頼など）
    python3 delegate.py --session <セッションID> --prompt-file <plan.md> --wait

# 委任先の作業が完了したら通知する
    python3 delegate.py --notify-done <宛先セッションID> <マーカーjson>
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

SERVER = "http://localhost:12000"
PROVIDER = "opencode-go"
MODEL = "space-bunny-free"

EXIT_OK = 0
EXIT_ERROR = 1


def post(path, payload, timeout=180):
    req = urllib.request.Request(
        f"{SERVER}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=timeout)


def get(path, timeout=30):
    return json.loads(urllib.request.urlopen(f"{SERVER}{path}", timeout=timeout).read())


def find_session(worktree, title, poll_seconds=180):
    """ディレクトリ指定でセッションを探す。なければ作る。"""
    existing = get(f"/session?directory={worktree}")
    for s in existing:
        if s.get("title") == title:
            return s["id"], True

    body = json.loads(post(f"/session?directory={worktree}", {"title": title}).read())
    sid = body.get("id") or body.get("info", {}).get("id")
    if not sid:
        raise RuntimeError(f"セッション作成に失敗しました: {body}")
    return sid, False


def resolve_session(args):
    """--session で指定があればそれを、無ければ worktree と title から探す。"""
    if args.session:
        return args.session, True
    return find_session(args.worktree, args.title)


def delegate(args):
    prompt = pathlib.Path(args.prompt_file).read_text(encoding="utf-8")
    sid, reused = resolve_session(args)
    print(f"session: {sid}{'（既存）' if reused else '（新規）'}")
    print(f"prompt: {len(prompt)} 文字")

    started = time.time()
    payload = {
        "parts": [{"type": "text", "text": prompt}],
        "model": {"providerID": PROVIDER, "modelID": MODEL},
    }
    resp = post(f"/session/{sid}/message?directory={args.worktree}", payload, timeout=3600)
    elapsed = time.time() - started

    body = json.loads(resp.read().decode("utf-8"))
    info = body.get("info", {})
    if info.get("error"):
        print(f"ERROR: {info['error']}")
        return EXIT_ERROR
    print(f"HTTP {resp.status} / {elapsed:.1f} 秒")

    text = "".join(p.get("text", "") for p in body.get("parts", []) if p.get("type") == "text")
    print("---")
    print(text)
    return EXIT_OK


def notify_done(args):
    marker = json.loads(pathlib.Path(args.marker_or_none).read_text(encoding="utf-8"))
    prompt = build_done_prompt(marker)
    resp = post(f"/session/{args.notify_done}/message", {
        "parts": [{"type": "text", "text": prompt}],
        "model": {"providerID": PROVIDER, "modelID": MODEL},
    })
    body = json.loads(resp.read().decode("utf-8"))
    if body.get("info", {}).get("error"):
        print(f"ERROR: {body['info']['error']}")
        return EXIT_ERROR
    print(f"OK: {args.notify_done} に通知しました（{len(prompt)} 文字）")
    return EXIT_OK


def build_done_prompt(marker):
    lines = ["委任した作業が完了しました。報告は以下のとおりです。", ""]
    for key in ("branch", "pr", "ci", "summary"):
        value = marker.get(key)
        if value:
            lines.append(f"- **{key}**: {value}")
    for section, title in (("checks", "確認事項"), ("notes", "補足")):
        items = marker.get(section)
        if items:
            lines.append("")
            lines.append(f"{title}:")
            lines.extend(f"- {item}" for item in items)
    lines.append("")
    lines.append("この内容を確認して、必要ならレビューや追加の作業を続けてください。")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--notify-done", metavar="DEST", help="完了通知を送る先のセッションID")
    parser.add_argument("marker_or_none", nargs="?", help="完了マーカーの JSON")
    parser.add_argument("--session", help="既存のセッション ID を直接指定する")
    parser.add_argument("--worktree", help="委任先の作業ツリー（ディレクトリ指定に使う）")
    parser.add_argument("--title", help="セッション名")
    parser.add_argument("--prompt-file", help="プロンプトのファイル")
    parser.add_argument("--log", help="バックグラウンド起動時のログ先")
    parser.add_argument("--wait", action="store_true", help="応答まで待つ")
    args = parser.parse_args()

    try:
        if args.notify_done:
            if not args.marker_or_none:
                parser.error("--notify-done にはマーカーの JSON が必要")
            return notify_done(args)
        if not args.prompt_file:
            parser.error("--prompt-file が必要")
        if not args.session and not (args.worktree and args.title):
            parser.error("--session か、--worktree と --title が必要")
        if args.wait:
            return delegate(args)
        cmd = [sys.executable, __file__, "--prompt-file", args.prompt_file, "--wait"]
        if args.session:
            cmd += ["--session", args.session]
        else:
            cmd += ["--worktree", args.worktree, "--title", args.title]
        log = open(args.log, "w", encoding="utf-8") if args.log else subprocess.DEVNULL
        subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        print(f"バックグラウンドで起動しました。ログ: {args.log or '(なし)'}")
        return EXIT_OK
    except urllib.error.URLError as error:
        print(f"サーバーに接続できません: {error}")
        print(f"opencode.service を確認してください（{SERVER}）")
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())