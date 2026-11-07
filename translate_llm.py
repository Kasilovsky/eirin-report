#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""永遠亭 医療報告 · 索引层标题翻译（LLM 通道）

``crawler.py`` 的 MyMemory 通道只能维持"大部分标题有中文"，
医学术语与语序经常失真。本脚本复用 ``digest.py`` 的注入配置，
把索引层尚未翻译的标题交给大模型批量翻译，写回 ``data/i18n_cache.json``
并同步更新 ``data/news.json``。

与 digest 共用同一个「暗门」：
* 密钥来自 ``DEEPSEEK_API_KEY`` / ``LLM_API_KEY`` 或本地 ``.env``
* ``EIRIN_LLM_MODE`` 控制启用与否
* 无密钥时不发任何请求，直接退出（不覆盖已有译文）

用法::

    python translate_llm.py                 # 默认取 200 条未译标题
    python translate_llm.py --limit 500     # 一次补更多
    python translate_llm.py --days 30       # 只补最近 30 天
    python translate_llm.py --dry-run       # 只统计不调用
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

import crawler
import digest

log = logging.getLogger("eirin.translate")

NEWS_FILE = Path("data/news.json")
CACHE_FILE = Path("data/i18n_cache.json")

DEFAULT_LIMIT = 200
BATCH_SIZE = 20
API_TIMEOUT = 120

SYSTEM_PROMPT = """你是医学期刊标题翻译。把英文标题译成简体中文。

规则：
1. 术语使用大陆临床常用译法，不要生造词、不要保留英文语序。
2. 药名、基因名、试验代号、器械名保留英文原文。
3. 数字、剂量、单位、统计缩写（HR、CI、PFS、EGFR、TAVR 等）保持原样。
4. 不添加任何解释、括号注释或译者说明。
5. 输出严格的 JSON 数组，元素格式 {"pmid": "...", "title_zh": "..."}，不要 markdown 代码块。"""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def cache_key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def load_cache() -> dict[str, str]:
    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {k: v for k, v in data.items() if isinstance(v, str) and v}
        except json.JSONDecodeError:
            log.warning("翻译缓存损坏，忽略")
    return {}


def save_cache(cache: dict[str, str]) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True),
        encoding="utf-8",
    )


def needs_translation(article: dict[str, Any]) -> bool:
    """没有中文标题，或中文标题与英文完全相同，都算未译。"""
    title_en = (article.get("title_en") or "").strip()
    title_zh = (article.get("title_zh") or "").strip()
    if not title_en:
        return False
    return not title_zh or title_zh == title_en


def call_llm(batch: list[dict[str, Any]], settings: dict[str, Any]) -> dict[str, str]:
    """返回 {pmid: title_zh}。"""
    payload = {
        "model": settings["model"],
        "temperature": 0.1,
        "max_tokens": 3000,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_prompt(batch)},
        ],
    }
    response = requests.post(
        f"{settings['base_url']}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings['key']}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=API_TIMEOUT,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    items = digest.parse_llm_json(content)

    allowed = {item["pmid"] for item in batch}
    result: dict[str, str] = {}
    for item in items:
        pmid = str(item.get("pmid") or "")
        title = str(item.get("title_zh") or "").strip()
        if pmid in allowed and title and len(title) >= 4:
            result[pmid] = title
    return result


def build_prompt(batch: list[dict[str, Any]]) -> str:
    lines = []
    for item in batch:
        lines.append(f"- pmid: {item['pmid']}\n  title: {item['title_en']}")
    return "翻译下列标题，输出 JSON 数组：\n\n" + "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="永遠亭 医療報告 索引层标题翻译")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="本次最多处理条数")
    parser.add_argument("--days", type=int, default=0, help="只处理最近 N 天（0 表示不限）")
    parser.add_argument("--dry-run", action="store_true", help="只统计，不调用模型")
    parser.add_argument("--retranslate", action="store_true",
                        help="连同已有中文标题一起重翻（用于覆盖机翻结果）")
    args = parser.parse_args()

    digest._load_dotenv()

    if not NEWS_FILE.exists():
        log.error("缺少 %s，请先运行 crawler.py", NEWS_FILE)
        return 1

    payload = json.loads(NEWS_FILE.read_text(encoding="utf-8"))
    articles = payload.get("articles") or []

    cutoff = ""
    if args.days > 0:
        cutoff = (utc_now().date() - timedelta(days=args.days)).isoformat()

    pending = [
        a for a in articles
        if (bool(a.get("title_en")) if args.retranslate else needs_translation(a))
        and (not cutoff or (a.get("date") or "") >= cutoff)
    ]
    pending.sort(key=lambda a: a.get("date") or "", reverse=True)
    pending = pending[:args.limit]

    log.info("待译 %s 条（窗口 %s 天，上限 %s）", len(pending), args.days or "不限", args.limit)
    if not pending:
        return 0
    if args.dry_run:
        for item in pending[:10]:
            print(f"  {item['pmid']}  {item['title_en'][:90]}")
        return 0

    settings = digest.llm_settings()
    if not settings["enabled"]:
        log.warning("LLM 未启用（%s），本次不翻译", settings["mode"])
        return 0

    cache = load_cache()
    translated: dict[str, str] = {}
    failed_batches = 0

    for start in range(0, len(pending), BATCH_SIZE):
        batch = pending[start:start + BATCH_SIZE]
        for attempt in (1, 2):
            try:
                produced = call_llm(batch, settings)
                if produced:
                    translated.update(produced)
                    break
            except Exception as exc:  # noqa: BLE001 - 网络/解析失败重试一次
                log.warning("批次 %s 第 %s 次失败：%s", start // BATCH_SIZE + 1, attempt, exc)
                time.sleep(2 * attempt)
        else:
            failed_batches += 1
        log.info("进度 %s/%s，成功 %s 条", min(start + BATCH_SIZE, len(pending)), len(pending), len(translated))
        time.sleep(0.8)

    if translated:
        for item in articles:
            title = translated.get(item["pmid"])
            if title:
                item["title_zh"] = title
                cache[cache_key(item["title_en"])] = title
        save_cache(cache)
        NEWS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    log.info("完成：翻译 %s 条，失败批次 %s，缓存条目 %s", len(translated), failed_batches, len(cache))
    # 翻译失败只意味着标题保留英文/旧译文，数据本身仍可发布，不应让 CI 失败
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
