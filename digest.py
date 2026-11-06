#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""永遠亭 医療報告 · 每日要目生成器

从 ``data/news.json`` 中挑出值得一读的一手研究，调用大模型生成面向非医学读者的
中文解读，输出 ``data/digest/YYYY-MM-DD.json``。

设计原则
--------
* **可注入、可关闭**：密钥只从环境变量读取，从不写进仓库文件。
  ``EIRIN_LLM_MODE`` 控制行为：``auto``（有 key 就用）/ ``off``（强制降级）/ ``force``（无 key 报错）。
* **绝不编造**：模型只拿到 PubMed 摘要原文，提示词明确禁止引入外部知识；
  摘要不足以判断结论时标注 ``confidence: low``，页面照实呈现。
* **失败降级**：无密钥、请求失败或输出不合法时，退回「题录模式」，
  产物中 ``degraded: true``，页面不伪装成有解读。

环境变量
--------
``DEEPSEEK_API_KEY``   或 ``LLM_API_KEY``：接口密钥（二选一）
``LLM_BASE_URL``       默认 ``https://api.deepseek.com/v1``（OpenAI 兼容）
``LLM_MODEL``          默认 ``deepseek-chat``
``EIRIN_LLM_MODE``     ``auto`` | ``off`` | ``force``

用法::

    python digest.py                  # 自动
    python digest.py --no-llm         # 题录模式
    python digest.py --days 3 --limit 8
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

import crawler

log = logging.getLogger("eirin.digest")

DATA_DIR = Path("data")
NEWS_FILE = DATA_DIR / "news.json"
DIGEST_DIR = DATA_DIR / "digest"

# 值得做成要目的研究类型（一手证据）
WANTED_PUBTYPES = {
    "Randomized Controlled Trial",
    "Meta-Analysis",
    "Systematic Review",
    "Clinical Trial, Phase III",
    "Clinical Trial, Phase II",
    "Practice Guideline",
    "Guideline",
    "Consensus Development Conference",
    "Observational Study",
}

# 明确排除的题录类型
EXCLUDED_PUBTYPES = {
    "Editorial",
    "Comment",
    "Letter",
    "News",
    "Case Reports",
    "Published Erratum",
    "Retraction of Publication",
}

DEFAULT_LIMIT = 10
DEFAULT_DAYS = 3
BATCH_SIZE = 4
API_TIMEOUT = 120

SYSTEM_PROMPT = """你是《永遠亭 医療報告》的医学编辑，负责把期刊论文改写成普通人能读懂的每日要目。
读者是聪明但没有医学训练的人：工程师、学生、关心健康的普通人。

写作规则：
1. 只能依据给出的摘要原文。不得引入摘要之外的知识、不得推测、不得编造数据。
2. 摘要没有给出结论或关键数字时，confidence 填 "low"，并在 key_finding 里写「摘要未给出结果」。
3. 所有数字、单位、剂量、置信区间、比率必须与摘要完全一致，禁止改写或四舍五入。
4. 药名、基因名、试验代号、统计缩写（HR、CI、PFS、EGFR 等）保留英文原文。
5. 中文术语使用大陆临床常用译法，不要生造词。
6. 区分「相关性」与「因果性」，摘要说 association 就不要写成 causes。
7. 输出严格的 JSON 数组，不要 markdown 代码块，不要额外解释。

每条输出字段：
- pmid: 原样返回
- title_zh: 准确、可读的中文标题（保留英文药名/代号）
- one_liner: 一句话结论，不超过 40 字，白话
- key_finding: 关键结果与数字，不超过 80 字
- why_it_matters: 对临床或公众意味着什么，不超过 80 字
- clinical_note: 给临床读者的补充（适用人群、局限），不超过 60 字；没有则空字符串
- evidence: 研究设计 + 样本量 + 地点/规模，不超过 35 字
- tags: 2-3 个科室或主题标签
- confidence: high | medium | low"""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# 配置（暗门）
# --------------------------------------------------------------------------- #

def _load_dotenv(path: str = ".env") -> None:
    """本地注入通道：读取 .env（该文件已在 .gitignore 中，绝不入库）。

    已存在的环境变量优先，不会被 .env 覆盖。
    """
    file = Path(path)
    if not file.exists():
        return
    for line in file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def llm_settings(mode_override: str | None = None) -> dict[str, Any]:
    key = (os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("LLM_API_KEY") or "").strip()
    mode = (mode_override or os.environ.get("EIRIN_LLM_MODE") or "auto").strip().lower()
    return {
        "key": key,
        "base_url": os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/"),
        "model": os.environ.get("LLM_MODEL", "deepseek-chat"),
        "mode": mode,
        "enabled": bool(key) and mode != "off",
    }


# --------------------------------------------------------------------------- #
# 候选筛选
# --------------------------------------------------------------------------- #

def pick_candidates(articles: list[dict[str, Any]], days: int, limit: int) -> list[dict[str, Any]]:
    cutoff = (utc_now().date() - timedelta(days=days)).isoformat()
    picked: list[dict[str, Any]] = []

    for article in articles:
        date = article.get("date") or ""
        if not date or date < cutoff:
            continue
        pubtypes = set(article.get("pubtypes") or [])
        if pubtypes & EXCLUDED_PUBTYPES:
            continue
        is_primary = bool(pubtypes & WANTED_PUBTYPES)
        if not is_primary and article.get("study_type") in {"述评", "评论", "通信", "病例报告", "要闻", "勘误"}:
            continue
        picked.append(article)

    # 优先一手研究，其次综述/指南；同优先级内按日期倒序
    def rank(article: dict[str, Any]) -> tuple[int, str]:
        pubtypes = set(article.get("pubtypes") or [])
        if pubtypes & {"Randomized Controlled Trial", "Clinical Trial, Phase III", "Meta-Analysis"}:
            weight = 0
        elif pubtypes & {"Systematic Review", "Practice Guideline", "Guideline", "Consensus Development Conference"}:
            weight = 1
        else:
            weight = 2
        return (weight, article.get("date") or "")

    picked.sort(key=lambda a: a.get("date") or "", reverse=True)
    picked.sort(key=lambda a: rank(a)[0])  # 稳定排序：先按日期倒序，再按证据等级
    return picked[:limit]


# --------------------------------------------------------------------------- #
# 补抓完整摘要
# --------------------------------------------------------------------------- #

def hydrate(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """用 efetch 拉取候选的**完整**摘要（news.json 里的摘要有过截断）。"""
    if not articles:
        return []
    pmids = [a["pmid"] for a in articles]
    log.info("补抓 %s 条完整摘要", len(pmids))
    nodes = crawler.efetch(pmids, batch_size=50)

    full_abstracts: dict[str, tuple[str, str]] = {}
    for node in nodes:
        pmid = crawler.text_of(node.find(".//PMID"))
        if not pmid:
            continue
        abstract, conclusion = crawler.parse_abstract(node)
        full_abstracts[pmid] = (abstract, conclusion)

    hydrated: list[dict[str, Any]] = []
    for article in articles:
        merged = dict(article)
        abstract, conclusion = full_abstracts.get(article["pmid"], ("", ""))
        merged["abstract_full"] = abstract
        merged["conclusion_en"] = conclusion
        hydrated.append(merged)
    return hydrated


# --------------------------------------------------------------------------- #
# LLM 调用
# --------------------------------------------------------------------------- #

def build_user_prompt(batch: list[dict[str, Any]]) -> str:
    blocks = []
    for item in batch:
        abstract = item.get("abstract_full") or item.get("summary_en") or ""
        blocks.append(
            f"### PMID {item['pmid']}\n"
            f"期刊：{item.get('journal', '')}\n"
            f"类型：{item.get('study_type') or '未标注'}\n"
            f"标题：{item.get('title_en', '')}\n"
            f"摘要：{abstract[:4000]}\n"
        )
    return "为以下论文各写一条要目，输出 JSON 数组：\n\n" + "\n".join(blocks)


def call_llm(batch: list[dict[str, Any]], settings: dict[str, Any]) -> list[dict[str, Any]]:
    payload = {
        "model": settings["model"],
        "temperature": 0.2,
        "max_tokens": 2400,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(batch)},
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
    return parse_llm_json(content)


def parse_llm_json(content: str) -> list[dict[str, Any]]:
    text = content.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1:
        raise ValueError("模型输出中没有 JSON 数组")
    data = json.loads(text[start:end + 1])
    if not isinstance(data, list):
        raise ValueError("模型输出不是数组")
    return data


REQUIRED_FIELDS = ("pmid", "title_zh", "one_liner", "key_finding", "why_it_matters", "evidence", "confidence")


def validate(items: list[dict[str, Any]], batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """字段齐全 + pmid 必须属于本批 + 置信度合法，否则丢该条。"""
    allowed = {item["pmid"] for item in batch}
    valid = []
    for item in items:
        pmid = str(item.get("pmid") or "")
        if pmid not in allowed:
            continue
        if any(not str(item.get(field) or "").strip() for field in REQUIRED_FIELDS):
            continue
        confidence = str(item.get("confidence") or "").lower()
        if confidence not in {"high", "medium", "low"}:
            item["confidence"] = "medium"
        item["pmid"] = pmid
        item["tags"] = [str(t) for t in (item.get("tags") or [])][:3]
        item["clinical_note"] = str(item.get("clinical_note") or "")
        valid.append(item)
    return valid


def build_digest(candidates: list[dict[str, Any]], settings: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """返回（要目列表, 是否降级）。"""
    if not candidates:
        return [], False

    if not settings["enabled"]:
        reason = "未提供 API 密钥" if settings["mode"] != "off" else "以 --no-llm 显式关闭"
        log.warning("LLM 不可用（%s），输出题录模式", reason)
        return [], True

    log.info("调用 %s 生成 %s 条要目", settings["model"], len(candidates))
    results: list[dict[str, Any]] = []
    degraded = False

    for start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[start:start + BATCH_SIZE]
        produced: list[dict[str, Any]] = []
        for attempt in (1, 2):
            try:
                produced = validate(call_llm(batch, settings), batch)
                if produced:
                    break
            except Exception as exc:  # noqa: BLE001 - 网络/解析失败统一降级
                log.warning("第 %s 批第 %s 次失败：%s", start // BATCH_SIZE + 1, attempt, exc)
                time.sleep(2 * attempt)
        if not produced:
            degraded = True
            log.error("第 %s 批未取得有效结果，跳过", start // BATCH_SIZE + 1)
        results.extend(produced)
        time.sleep(1)

    return results, degraded


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser(description="永遠亭 医療報告 每日要目生成")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="候选时间窗口（天）")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="候选条数上限")
    parser.add_argument("--no-llm", action="store_true", help="强制题录模式，不调用模型")
    parser.add_argument("--mode", choices=["auto", "off", "force"], default=None, help="覆盖 EIRIN_LLM_MODE")
    args = parser.parse_args()

    _load_dotenv()

    if not NEWS_FILE.exists():
        log.error("缺少 %s，请先运行 crawler.py", NEWS_FILE)
        return 1

    payload = json.loads(NEWS_FILE.read_text(encoding="utf-8"))
    articles = payload.get("articles") or []
    candidates = pick_candidates(articles, args.days, args.limit)
    log.info("窗口 %s 天，候选 %s 条", args.days, len(candidates))
    if not candidates:
        log.warning("近期没有符合要目条件的一手研究")

    hydrated = hydrate(candidates)
    settings = llm_settings("off" if args.no_llm else args.mode)

    if settings["mode"] == "force" and not settings["key"]:
        log.error("EIRIN_LLM_MODE=force 但未提供 API 密钥")
        return 1

    generated, degraded = build_digest(hydrated, settings)

    by_pmid = {item["pmid"]: item for item in hydrated}
    items = []
    for item in generated:
        source = by_pmid.get(item["pmid"], {})
        items.append({
            "pmid": item["pmid"],
            "journal": source.get("journal_abbr") or source.get("journal") or "",
            "date": source.get("date") or "",
            "link": source.get("link") or "",
            "title_en": source.get("title_en") or "",
            "study_type": source.get("study_type") or "",
            "departments": source.get("departments") or [],
            "title_zh": item.get("title_zh", ""),
            "one_liner": item.get("one_liner", ""),
            "key_finding": item.get("key_finding", ""),
            "why_it_matters": item.get("why_it_matters", ""),
            "clinical_note": item.get("clinical_note", ""),
            "evidence": item.get("evidence", ""),
            "tags": item.get("tags", []),
            "confidence": item.get("confidence", "medium"),
        })

    # 题录模式：保留候选清单，便于读者自行查阅
    if not items:
        items = [{
            "pmid": a["pmid"],
            "journal": a.get("journal_abbr") or "",
            "date": a.get("date") or "",
            "link": a.get("link") or "",
            "title_en": a.get("title_en") or "",
            "study_type": a.get("study_type") or "",
            "departments": a.get("departments") or [],
            "title_zh": a.get("title_zh") or "",
            "one_liner": "",
            "key_finding": "",
            "why_it_matters": "",
            "clinical_note": "",
            "evidence": "",
            "tags": [],
            "confidence": "low",
        } for a in hydrated]

    today = datetime.now().astimezone().date().isoformat()
    digest = {
        "schema_version": 1,
        "date": today,
        "generated_at": utc_now().astimezone().isoformat(timespec="seconds"),
        "provider": settings["model"] if generated else "none",
        "degraded": degraded or not generated,
        "window_days": args.days,
        "count": len(items),
        "items": items,
    }

    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    target = DIGEST_DIR / f"{today}.json"
    target.write_text(json.dumps(digest, ensure_ascii=False, indent=1), encoding="utf-8")

    latest = DIGEST_DIR / "latest.json"
    latest.write_text(json.dumps(digest, ensure_ascii=False, indent=1), encoding="utf-8")

    log.info("已写入 %s 条要目 -> %s（degraded=%s）", len(items), target, digest["degraded"])
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
