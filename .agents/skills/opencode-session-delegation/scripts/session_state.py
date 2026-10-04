#!/usr/bin/env python3
"""OpenCode Web API でセッションの稼働状況を調べる。

pgrep やプロセス一覧ではなく、サーバに問い合わせる。
サーバが応答するならその結果を信じる。プロセスは目印にすぎない。

使い方:
    python3 session_state.py <セッションID> [<worktree パス>]
    python3 session_state.py --all
"""
import json
import sys
import urllib.request

SERVER = "http://localhost:12000"
TIMEOUT = 10

# 停止とみなせる条件のヒント。
# 1 つでも当てはまれば「動いていない」と判断する材料になる。
# コールドスタートの空白はここに含まれない点に注意。
IDLE_EVIDENCE = {
    "server_down": "サーバーが応答しない",
    "no_tool_running": "最後のメッセージに実行中ツールが無い",
    "last_message_done": "最後のメッセージに time.completed が付いている",
}


def get(path):
    with urllib.request.urlopen(f"{SERVER}{path}", timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def server_alive():
    try:
        get("/session/status")
        return True
    except Exception as error:
        print(f"  サーバーに接続できません: {error}")
        return False


def inspect(session_id, worktree):
    query = f"?directory={worktree}&limit=5" if worktree else "?limit=5"
    messages = get(f"/session/{session_id}/message{query}")
    if not messages:
        print("  メッセージがまだない（セッションは存在する）")
        return []

    last = messages[-1]
    info = last.get("info", {})
    parts = last.get("parts", [])
    tools = [p for p in parts if p.get("type") == "tool"]
    running = [p for p in tools if p.get("state", {}).get("status") == "running"]
    completed_at = info.get("time", {}).get("completed")

    print(f"  role={info.get('role')} agent={info.get('agent')}")
    print(f"  完了={'あり' if completed_at else 'なし（未完了）'}")
    print(f"  ツール {len(tools)} 個 / 実行中 {len(running)} 個")
    for p in running[:3]:
        state = p.get("state", {})
        inp = state.get("input", {})
        target = inp.get("command") or inp.get("filePath") or inp.get("pattern") or ""
        print(f"    - {p.get('tool')}: {str(target)[:100]}")
    if completed_at:
        text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        if text:
            print(f"  最終回答: {text[:300]}")

    evidence = []
    if not running:
        evidence.append(IDLE_EVIDENCE["no_tool_running"])
    if completed_at:
        evidence.append(IDLE_EVIDENCE["last_message_done"])
    return evidence


def list_all():
    for s in get("/session?limit=40"):
        print(f"  {s.get('id')} | {s.get('title','')[:40]} | {s.get('directory','?')}")
    return 0


def main():
    if not server_alive():
        return 1
    if "--all" in sys.argv:
        return list_all()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    print(f"=== {args[0]} ===")
    evidence = inspect(args[0], args[1] if len(args) > 1 else None)
    print("  判定材料:")
    for e in evidence or ["（特に気になる材料なし）"]:
        print(f"    - {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())