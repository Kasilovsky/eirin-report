#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""永遠亭 医療報告 · 本地編輯後台

只在 127.0.0.1 上運行，提供一個可視化頁面編輯 ``data/forewords.json``：

    python edit_server.py
    # 瀏覽器打開 http://127.0.0.1:8766/

編輯的是刊首語：
* ``index``   首頁輪換的 20 條（可增刪、調整順序）
* ``discuss`` 竹林茶會頁那句

保存後直接寫回文件，網站刷新即可看到（靜態站點在 8765 另開）。
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
FOREWORDS = ROOT / "data" / "forewords.json"
PORT = 8766

PAGE = r"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>刊首語編輯器 · 永遠亭</title>
<style>
:root { --paper:#f7f4ec; --ink:#1b2224; --ink2:#4a5457; --ink3:#7c8585; --rule:#d9d2c1; --accent:#8c2f1f; --deep:#1f3a5f; }
@media (prefers-color-scheme: dark) {
  :root { --paper:#121719; --ink:#e7e3d9; --ink2:#b0aa9e; --ink3:#837f76; --rule:#2f3639; --accent:#d9694e; --deep:#8fb4d9; }
}
* { box-sizing: border-box; }
body { margin:0; padding:28px 20px 80px; background:var(--paper); color:var(--ink);
  font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,Georgia,serif; line-height:1.7; }
.wrap { max-width:780px; margin:0 auto; }
h1 { font-size:1.4rem; letter-spacing:.2em; margin:0 0 4px; }
.sub { font-family:system-ui,sans-serif; font-size:.74rem; color:var(--ink3); margin:0 0 24px; }
h2 { font-size:1rem; letter-spacing:.14em; margin:0 0 12px; color:var(--ink); }
section { border-top:1px solid var(--rule); padding-top:18px; margin-top:22px; }
.item { display:grid; grid-template-columns:34px 1fr auto; gap:10px; align-items:start; margin-bottom:10px; }
.idx { font-family:system-ui,sans-serif; font-size:.76rem; color:var(--ink3); padding-top:10px; }
textarea { width:100%; min-height:52px; padding:9px 11px; font-family:inherit; font-size:.9rem; line-height:1.7;
  color:var(--ink); background:var(--paper); border:1px solid var(--rule); border-radius:2px; resize:vertical; outline:none; }
textarea:focus { border-color:var(--deep); }
.ops { display:flex; flex-direction:column; gap:4px; }
.ops button { font-family:system-ui,sans-serif; font-size:.7rem; color:var(--ink2); background:none;
  border:1px solid var(--rule); border-radius:2px; padding:3px 8px; cursor:pointer; }
.ops button:hover { border-color:var(--deep); color:var(--deep); }
.ops button:disabled { opacity:.35; cursor:default; }
.bar { position:fixed; left:0; right:0; bottom:0; display:flex; gap:12px; align-items:center;
  padding:12px 20px; background:var(--paper); border-top:1px solid var(--rule); }
.btn { font-family:system-ui,sans-serif; font-size:.8rem; padding:8px 18px; border-radius:2px; cursor:pointer;
  border:1px solid var(--deep); background:var(--deep); color:#fff; }
.btn.ghost { background:none; color:var(--ink2); border-color:var(--rule); }
.status { font-family:system-ui,sans-serif; font-size:.76rem; color:var(--ink3); }
.status.ok { color:var(--deep); }
.status.err { color:var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <h1>刊首語編輯器</h1>
  <p class="sub">只在本機運行。修改後按「保存」寫回 data/forewords.json，刷新網站即可看到。</p>

  <section>
    <h2>首頁輪換（index）</h2>
    <div id="list"></div>
    <button class="btn ghost" id="add">＋ 新增一條</button>
  </section>

  <section>
    <h2>竹林茶會（discuss）</h2>
    <textarea id="discuss" rows="2"></textarea>
  </section>
</div>

<div class="bar">
  <button class="btn" id="save">保存</button>
  <button class="btn" id="publish" style="background:var(--accent);border-color:var(--accent)">保存並發布</button>
  <button class="btn ghost" id="reload">重新載入</button>
  <span class="status" id="status">就緒</span>
</div>

<script>
let data = { index: [], discuss: "" };

const listEl = document.getElementById("list");
const discussEl = document.getElementById("discuss");
const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function render() {
  listEl.innerHTML = data.index.map((text, i) => `
    <div class="item">
      <div class="idx">${String(i + 1).padStart(2, "0")}</div>
      <textarea data-i="${i}" rows="2">${text.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</textarea>
      <div class="ops">
        <button data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑</button>
        <button data-move="${i}" data-dir="1" ${i === data.index.length - 1 ? "disabled" : ""}>↓</button>
        <button data-del="${i}">刪</button>
      </div>
    </div>`).join("");

  listEl.querySelectorAll("textarea[data-i]").forEach(el => {
    el.addEventListener("input", () => { data.index[Number(el.dataset.i)] = el.value; });
  });
  listEl.querySelectorAll("[data-del]").forEach(el => {
    el.addEventListener("click", () => { data.index.splice(Number(el.dataset.del), 1); render(); });
  });
  listEl.querySelectorAll("[data-move]").forEach(el => {
    el.addEventListener("click", () => {
      const i = Number(el.dataset.move), dir = Number(el.dataset.dir), j = i + dir;
      if (j < 0 || j >= data.index.length) return;
      [data.index[i], data.index[j]] = [data.index[j], data.index[i]];
      render();
    });
  });
}

async function load() {
  try {
    const res = await fetch("/api/forewords", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    data = { index: json.index || [], discuss: json.discuss || "" };
    discussEl.value = data.discuss;
    render();
    setStatus("已載入 " + data.index.length + " 條", "ok");
  } catch (e) {
    setStatus("載入失敗：" + e.message, "err");
  }
}

async function save() {
  data.discuss = discussEl.value;
  data.index = data.index.map(t => t.trim());
  try {
    const res = await fetch("/api/forewords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const out = await res.json();
    setStatus("已保存（" + out.count + " 條）", "ok");
    loadStatus();
  } catch (e) {
    setStatus("保存失敗：" + e.message, "err");
  }
}

document.getElementById("add").addEventListener("click", () => {
  data.index.push("");
  render();
  setStatus("已新增一條空白（記得填寫後保存）");
});
document.getElementById("save").addEventListener("click", save);

async function publish() {
  await save();
  setStatus("正在推送…");
  try {
    const res = await fetch("/api/publish", { method: "POST" });
    const out = await res.json();
    setStatus(out.message, out.ok ? "ok" : "err");
    loadStatus();
  } catch (e) {
    setStatus("發布失敗：" + e.message, "err");
  }
}
document.getElementById("publish").addEventListener("click", publish);
document.getElementById("reload").addEventListener("click", load);
discussEl.addEventListener("input", () => { data.discuss = discussEl.value; });

async function loadStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    const s = await res.json();
    const parts = [];
    if (s.dirty) parts.push("本地有未保存改动");
    if (s.ahead > 0) parts.push("未推送 " + s.ahead + " 个提交");
    if (s.behind > 0) parts.push("远端新 " + s.behind + " 个提交");
    setStatus(parts.length ? parts.join(" · ") : "已同步", parts.length ? "" : "ok");
  } catch (e) { /* 忽略 */ }
}

loadStatus();
load();
</script>
</body>
</html>
"""


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def publish_forewords() -> tuple[bool, str]:
    """把 data/forewords.json 提交並推送到 GitHub，失敗時重試。"""
    staged = git("add", "data/forewords.json")
    if staged.returncode != 0:
        return False, staged.stderr.strip() or "git add 失敗"

    status = git("status", "--porcelain", "data/forewords.json")
    if status.returncode == 0 and not status.stdout.strip():
        return True, "文件沒有變更，無需提交"

    commit = git("commit", "-m", "content: 更新刊首語")
    if commit.returncode != 0:
        return False, (commit.stderr or commit.stdout).strip()[-300:]

    last_error = ""
    for _ in range(3):
        push = git("-c", "http.version=HTTP/1.1", "push", "origin", "main")
        if push.returncode == 0:
            return True, "已推送，Pages 約 1 分鐘後生效"
        last_error = (push.stderr or push.stdout).strip()[-300:]
        time.sleep(3)

    return False, f"推送失敗（已提交本地）：{last_error}"


def git_status() -> dict:
    """本地文件是否有改动、本地与远端各差多少提交。"""
    dirty = git("status", "--porcelain", "data/forewords.json")
    ahead = git("rev-list", "--count", "origin/main..HEAD")
    behind = git("rev-list", "--count", "HEAD..origin/main")
    return {
        "dirty": bool(dirty.stdout.strip()),
        "ahead": int(ahead.stdout.strip() or 0) if ahead.returncode == 0 else -1,
        "behind": int(behind.stdout.strip() or 0) if behind.returncode == 0 else -1,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/forewords":
            try:
                data = json.loads(FOREWORDS.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                self._send(500, json.dumps({"error": str(exc)}).encode("utf-8"), "application/json")
                return
            self._send(200, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json")
        elif path == "/api/status":
            self._send(200, json.dumps(git_status(), ensure_ascii=False).encode("utf-8"), "application/json")
        else:
            self._send(404, b"Not Found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/publish":
            ok, message = publish_forewords()
            self._send(
                200 if ok else 500,
                json.dumps({"ok": ok, "message": message}, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
            return

        if path != "/api/forewords":
            self._send(404, b"Not Found", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            index = payload.get("index")
            discuss = payload.get("discuss", "")
            if not isinstance(index, list) or not all(isinstance(t, str) for t in index):
                raise ValueError("index 必須是字串陣列")
            if not isinstance(discuss, str):
                raise ValueError("discuss 必須是字串")
            cleaned = [t.strip() for t in index if t.strip()]
            if not cleaned:
                raise ValueError("至少要保留一條刊首語")
            data = {"index": cleaned, "discuss": discuss.strip()}
            FOREWORDS.parent.mkdir(parents=True, exist_ok=True)
            FOREWORDS.write_text(
                json.dumps(data, ensure_ascii=False, indent=1) + "\n",
                encoding="utf-8",
            )
            self._send(
                200,
                json.dumps({"ok": True, "count": len(cleaned)}, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        except Exception as exc:  # noqa: BLE001 - 本地工具，統一回報
            self._send(400, json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8"), "application/json")

    def log_message(self, fmt: str, *args) -> None:  # 靜默請求日誌
        return


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"刊首語編輯器: http://127.0.0.1:{PORT}/")
    print(f"編輯文件: {FOREWORDS}")
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    return 0


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    raise SystemExit(main())
