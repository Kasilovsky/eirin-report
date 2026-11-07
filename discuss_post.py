#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""將當日要目開成一個討論帖（GitHub Issues）

由每日工作流在 digest 生成後調用。沒有 ``GITHUB_TOKEN`` 時直接跳過，
不會影響主流程。

去重規則：標題帶當天日期，已存在同標題的 issue 就不再重複開帖。
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

log = logging.getLogger("eirin.discuss")

API = "https://api.github.com"
REPO = os.environ.get("GITHUB_REPOSITORY", "Kasilovsky/eirin-report")
TOKEN = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
DIGEST_FILE = Path("data/digest/latest.json")


def api(method: str, path: str, **kwargs) -> requests.Response:
    return requests.request(
        method,
        f"{API}{path}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "eirin-report",
        },
        timeout=30,
        **kwargs,
    )


def build_body(date: str, items: list[dict]) -> str:
    lines = [
        f"本期要目共 {len(items)} 則，結論與數字均取自 PubMed 摘要原文。",
        "",
        "歡迎就任何一條提出質疑、補充或糾錯；也歡迎建議下一期想看的方向。",
        "",
        "---",
        "",
    ]
    for index, item in enumerate(items, 1):
        journal = item.get("journal") or item.get("journal_abbr") or ""
        study = item.get("study_type") or "研究"
        lines.append(f"### {index:02d}｜{journal}｜{study}")
        lines.append("")
        title = item.get("title_zh") or item.get("title_en") or ""
        if title:
            lines.append(f"**{title}**")
            lines.append("")
        if item.get("one_liner"):
            lines.append(f"> {item['one_liner']}")
            lines.append("")
        if item.get("key_finding"):
            lines.append(item["key_finding"])
            lines.append("")
        if item.get("link"):
            lines.append(f"[PubMed 原文]({item['link']})")
            lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("—— 永遠亭 医療部 · 八意永琳")
    return "\n".join(lines)


def main() -> int:
    if not TOKEN:
        log.warning("未提供 GITHUB_TOKEN，跳过开帖")
        return 0
    if not DIGEST_FILE.exists():
        log.warning("缺少 %s，跳过", DIGEST_FILE)
        return 0

    payload = json.loads(DIGEST_FILE.read_text(encoding="utf-8"))
    items = payload.get("items") or []
    if not items:
        log.warning("要目为空，跳过开帖")
        return 0

    date = payload.get("date") or datetime.now().strftime("%Y-%m-%d")
    title = f"本期要目讨论 · {date}"

    listed = api("GET", f"/repos/{REPO}/issues?state=all&per_page=30&sort=created&direction=desc")
    if listed.ok:
        for issue in listed.json():
            if issue.get("title") == title:
                log.info("当天的讨论帖已存在：%s", issue.get("html_url"))
                return 0
    else:
        log.warning("读取 issues 失败（%s），继续尝试开帖", listed.status_code)

    response = api(
        "POST",
        f"/repos/{REPO}/issues",
        json={"title": title, "body": build_body(date, items)},
    )
    if response.status_code not in (200, 201):
        log.error("开帖失败 %s：%s", response.status_code, response.text[:300])
        return 1

    log.info("已创建讨论帖：%s", response.json().get("html_url"))
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    raise SystemExit(main())
