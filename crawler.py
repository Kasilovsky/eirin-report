#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""永遠亭 医療報告 · データ収集器 (v2)

从 PubMed E-utilities 采集七种权威期刊的近期文献，生成供静态站点使用的
``data/news.json``、按月归档 ``data/archive/YYYY-MM.json`` 以及 RSS 订阅源
``feed.xml``。

设计要点
--------
* 以 PMID 为主键做增量 upsert，不再每天整份覆盖 —— 抓取失败也不会把站点写空。
* 通过 efetch(XML) 一次性取回标题、摘要、作者、DOI、MeSH，分类与摘要不再依赖
  残缺的 esummary 字段。
* 标题翻译带本地缓存与配额预算，只翻新增条目，避免重复消耗免费翻译额度。
* 日期优先取 ArticleDate / PubDate，彻底移除旧版 ``pubdate[:10]`` 的截断错误。

用法::

    python crawler.py                # 增量更新（GitHub Actions 默认）
    python crawler.py --full         # 忽略本地已有数据，全量重建
    python crawler.py --days 30      # 只取最近 30 天
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import requests

# --------------------------------------------------------------------------- #
# 配置
# --------------------------------------------------------------------------- #

SCHEMA_VERSION = 2
DATA_DIR = Path("data")
NEWS_FILE = DATA_DIR / "news.json"
CACHE_FILE = DATA_DIR / "i18n_cache.json"
ARCHIVE_DIR = DATA_DIR / "archive"
FEED_FILE = Path("feed.xml")

WINDOW_DAYS = 180
PER_JOURNAL = 100
TRANSLATE_BUDGET = int(os.environ.get("EIRIN_TRANSLATE_BUDGET", "300"))
MYMEMORY_EMAIL = os.environ.get("MYMEMORY_EMAIL", "").strip()

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get"

HEADERS = {
    "User-Agent": "eirin-report/2.0 (medical digest generator; contact via GitHub)",
}

# 期刊：检索缩写 -> 显示名
JOURNALS: dict[str, str] = {
    "N Engl J Med": "New England Journal of Medicine",
    "Lancet": "The Lancet",
    "JAMA": "JAMA",
    "BMJ": "BMJ",
    "Nat Med": "Nature Medicine",
    "Cell": "Cell",
    "Sci Transl Med": "Science Translational Medicine",
}

# 发表类型 -> 中文标签
PUBTYPE_LABELS: dict[str, str] = {
    "Randomized Controlled Trial": "随机对照试验",
    "Clinical Trial": "临床试验",
    "Clinical Trial, Phase I": "I 期临床试验",
    "Clinical Trial, Phase II": "II 期临床试验",
    "Clinical Trial, Phase III": "III 期临床试验",
    "Meta-Analysis": "Meta 分析",
    "Systematic Review": "系统综述",
    "Review": "综述",
    "Practice Guideline": "临床指南",
    "Guideline": "临床指南",
    "Consensus Development Conference": "共识声明",
    "Observational Study": "观察性研究",
    "Case Reports": "病例报告",
    "Editorial": "述评",
    "Comment": "评论",
    "News": "要闻",
    "Letter": "通信",
    "Journal Article": "研究论文",
}

# MeSH 主要类目 -> 科室
DEPT_RULES: list[tuple[str, str]] = [
    ("cardiovascular", "循环器"),
    ("heart", "循环器"),
    ("myocardial", "循环器"),
    ("coronary", "循环器"),
    ("cardiac", "循环器"),
    ("infarct", "循环器"),
    ("arrhythm", "循环器"),
    ("atrial fibrillation", "循环器"),
    ("valvular", "循环器"),
    ("atheroscler", "循环器"),
    ("hypertension", "循环器"),
    ("vascular", "循环器"),
    ("stroke", "神经"),
    ("brain", "神经"),
    ("nervous system", "神经"),
    ("neurolog", "神经"),
    ("alzheimer", "神经"),
    ("neoplasm", "肿瘤"),
    ("cancer", "肿瘤"),
    ("oncolog", "肿瘤"),
    ("carcinoma", "肿瘤"),
    ("tumor", "肿瘤"),
    ("lymphoma", "肿瘤"),
    ("leukemia", "肿瘤"),
    ("infection", "感染"),
    ("virus", "感染"),
    ("viral", "感染"),
    ("bacterial", "感染"),
    ("sepsis", "感染"),
    ("covid", "感染"),
    ("influenza", "感染"),
    ("avian", "感染"),
    ("bird flu", "感染"),
    ("ebola", "感染"),
    ("tuberculosis", "感染"),
    ("hepatitis", "感染"),
    ("immunodeficien", "感染"),
    ("respiratory", "呼吸器"),
    ("lung", "呼吸器"),
    ("pulmonary", "呼吸器"),
    ("asthma", "呼吸器"),
    ("copd", "呼吸器"),
    ("digestive", "消化器"),
    ("gastro", "消化器"),
    ("intestin", "消化器"),
    ("hepat", "消化器"),
    ("liver", "消化器"),
    ("colorectal", "消化器"),
    ("pancrea", "消化器"),
    ("endocrine", "内分泌/代谢"),
    ("diabet", "内分泌/代谢"),
    ("metabolic", "内分泌/代谢"),
    ("obesity", "内分泌/代谢"),
    ("thyroid", "内分泌/代谢"),
    ("cholesterol", "内分泌/代谢"),
    ("immune", "免疫/风湿"),
    ("autoimmune", "免疫/风湿"),
    ("rheumat", "免疫/风湿"),
    ("arthritis", "免疫/风湿"),
    ("lupus", "免疫/风湿"),
    ("musculoskeletal", "骨科"),
    ("bone", "骨科"),
    ("orthoped", "骨科"),
    ("fracture", "骨科"),
    ("hematolog", "血液"),
    ("anemia", "血液"),
    ("thromb", "血液"),
    ("coagulat", "血液"),
    ("kidney", "肾脏/泌尿"),
    ("renal", "肾脏/泌尿"),
    ("urolog", "肾脏/泌尿"),
    ("prostate", "肾脏/泌尿"),
    ("bladder", "肾脏/泌尿"),
    ("ophthalm", "眼科"),
    ("retina", "眼科"),
    ("glaucoma", "眼科"),
    ("otorhinolaryngolog", "耳鼻咽喉"),
    ("hearing", "耳鼻咽喉"),
    ("dermatolog", "皮肤"),
    ("skin", "皮肤"),
    ("psoriasis", "皮肤"),
    ("pediatric", "儿科"),
    ("child", "儿科"),
    ("infant", "儿科"),
    ("neonat", "儿科"),
    ("geriatric", "老年医学"),
    ("aging", "老年医学"),
    ("obstetric", "妇产"),
    ("pregnan", "妇产"),
    ("gynecolog", "妇产"),
    ("mental", "精神"),
    ("psychiatr", "精神"),
    ("depress", "精神"),
    ("anxiety", "精神"),
    ("dementia", "精神"),
    ("public health", "公共卫生"),
    ("epidemiolog", "公共卫生"),
    ("health policy", "公共卫生"),
    ("global health", "公共卫生"),
    ("pharmacolog", "药学"),
    ("drug therapy", "药学"),
    ("genetic", "遗传/基因"),
    ("gene therapy", "遗传/基因"),
    ("genome", "遗传/基因"),
    ("crispr", "遗传/基因"),
    ("vaccin", "疫苗"),
    ("surgery", "外科"),
    ("surgical", "外科"),
    ("thorac", "外科"),
    ("postoperative", "外科"),
    ("anesthes", "麻醉/重症"),
    ("critical care", "麻醉/重症"),
    ("intensive care", "麻醉/重症"),
    ("transplant", "移植"),
]

STOPWORDS = {"a", "an", "the", "of", "in", "on", "for", "and", "or", "to", "with"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("eirin")


# --------------------------------------------------------------------------- #
# 通用工具
# --------------------------------------------------------------------------- #

def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def http_get(url: str, params: dict[str, Any] | None = None, *, tries: int = 4,
             timeout: int = 30) -> requests.Response:
    """带指数退避的 GET，失败抛最后一次异常。"""
    delay = 1.0
    last: Exception | None = None
    for attempt in range(1, tries + 1):
        try:
            resp = requests.get(url, params=params, headers=HEADERS, timeout=timeout)
            if resp.status_code == 429:
                raise requests.HTTPError(f"429 rate limited ({url})")
            resp.raise_for_status()
            return resp
        except Exception as exc:  # noqa: BLE001 - 网络层统一兜底
            last = exc
            if attempt == tries:
                break
            log.warning("请求失败（%s/%s）：%s，%.1fs 后重试", attempt, tries, exc, delay)
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"请求重试耗尽: {url}") from last


def text_of(node: ET.Element | None) -> str:
    """把（可能含内联标签的）XML 节点还原为纯文本。"""
    if node is None:
        return ""
    return re.sub(r"\s+", " ", "".join(node.itertext())).strip()


# --------------------------------------------------------------------------- #
# PubMed 采集
# --------------------------------------------------------------------------- #

def esearch(journal_abbr: str, days: int, retmax: int = PER_JOURNAL) -> list[str]:
    end = utc_now().date()
    start = end - timedelta(days=days)
    term = (
        f'"{journal_abbr}"[ta] AND '
        f'("{start.strftime("%Y/%m/%d")}"[dp] : "{end.strftime("%Y/%m/%d")}"[dp])'
    )
    payload = http_get(
        f"{EUTILS}/esearch.fcgi",
        {
            "db": "pubmed",
            "term": term,
            "retmax": retmax,
            "sort": "pub_date",
            "retmode": "json",
        },
    ).json()
    result = payload.get("esearchresult", {})
    if result.get("ERROR"):
        raise RuntimeError(f"esearch 错误: {result['ERROR']}")
    return list(result.get("idlist", []))


def efetch(pmids: Iterable[str], batch_size: int = 50) -> list[ET.Element]:
    """按批拉取 PubMed XML，返回 PubmedArticle 节点列表。"""
    ids = list(pmids)
    nodes: list[ET.Element] = []
    for i in range(0, len(ids), batch_size):
        chunk = ids[i:i + batch_size]
        resp = http_get(
            f"{EUTILS}/efetch.fcgi",
            {"db": "pubmed", "id": ",".join(chunk), "retmode": "xml", "rettype": "abstract"},
        )
        try:
            root = ET.fromstring(resp.content)
        except ET.ParseError as exc:
            log.error("XML 解析失败（批次 %s）：%s", i // batch_size + 1, exc)
            continue
        nodes.extend(root.findall(".//PubmedArticle"))
        time.sleep(0.4)  # 无 API key 时上限 3 req/s
    return nodes


def parse_pubdate(article: ET.Element) -> str:
    """按 PubDate（期号出版日）-> ArticleDate（电子版）-> MedlineDate 解析出版日期。

    期刊的正式引用日期来自 JournalIssue/PubDate，与引文保持一致；
    ArticleDate 仅作为缺失时的兜底。
    """
    candidates: list[tuple[str, str, str]] = []

    for node in article.findall(".//JournalIssue/PubDate"):
        year = text_of(node.find("Year"))
        month = text_of(node.find("Month"))
        day = text_of(node.find("Day"))
        medline = text_of(node.find("MedlineDate"))
        if year:
            candidates.append((year, month, day))
        elif medline:
            match = re.match(r"(\d{4})(?:\s+([A-Za-z]{3,9}))?", medline)
            if match:
                candidates.append((match.group(1), match.group(2) or "", ""))

    for node in article.findall(".//ArticleDate"):
        candidates.append((text_of(node.find("Year")), text_of(node.find("Month")), text_of(node.find("Day"))))

    months = {name: idx for idx, name in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
    for year, month, day in candidates:
        try:
            y = int(year)
        except (TypeError, ValueError):
            continue
        m = 12
        if month:
            if month.isdigit():
                m = int(month)
            else:
                m = months.get(month[:3].lower(), 12)
        d = 1
        if day and day.isdigit():
            d = int(day)
        if 1900 <= y <= 2100 and 1 <= m <= 12:
            return f"{y:04d}-{m:02d}-{d:02d}"
    return ""


def parse_abstract(article: ET.Element) -> tuple[str, str]:
    """返回（完整摘要, 结论段）。结论段优先取 CONCLUSIONS 标签。"""
    chunks: list[str] = []
    conclusion = ""
    for node in article.findall(".//Abstract/AbstractText"):
        label = (node.get("Label") or "").upper()
        body = text_of(node)
        if not body:
            continue
        if label:
            chunks.append(f"{label}: {body}")
        else:
            chunks.append(body)
        if label in {"CONCLUSIONS", "CONCLUSION", "INTERPRETATION"}:
            conclusion = body
    full = " ".join(chunks)
    if not conclusion and full:
        sentences = re.split(r"(?<=[.!?])\s+", full)
        for sentence in reversed(sentences):
            if re.search(r"(conclu|interpret|we found|our findings|these findings|suggest)", sentence, re.I):
                conclusion = sentence
                break
        if not conclusion:
            conclusion = sentences[-1] if sentences else ""
    return full, conclusion


def parse_article(node: ET.Element) -> dict[str, Any] | None:
    pmid = text_of(node.find(".//PMID"))
    if not pmid:
        return None

    journal_node = node.find(".//Journal")
    medline_ta = text_of(node.find(".//MedlineJournalInfo/MedlineTA"))
    title_abbr = text_of(node.find(".//Journal/ISOAbbreviation")) or text_of(node.find(".//Journal/Title"))
    if medline_ta not in JOURNALS:
        log.debug("跳过非目标期刊：%s (%s)", medline_ta or title_abbr, pmid)
        return None

    title_en = text_of(node.find(".//Article/ArticleTitle"))
    if not title_en:
        return None

    abstract, conclusion = parse_abstract(node)

    authors: list[str] = []
    for author in node.findall(".//AuthorList/Author"):
        last = text_of(author.find("LastName"))
        initials = text_of(author.find("Initials"))
        collective = text_of(author.find("CollectiveName"))
        if last:
            authors.append(f"{last} {initials}".strip())
        elif collective:
            authors.append(collective)

    doi = ""
    for art_id in node.findall(".//ArticleIdList/ArticleId"):
        if (art_id.get("IdType") or "").lower() == "doi":
            doi = (art_id.text or "").strip()
            break

    pubtypes = [text_of(n) for n in node.findall(".//PublicationTypeList/PublicationType")]
    study_type = ""
    # 按"具体 -> 笼统"的优先级匹配，避免 Journal Article 抢先命中
    for key in ("Randomized Controlled Trial", "Meta-Analysis", "Systematic Review",
                "Practice Guideline", "Guideline", "Consensus Development Conference",
                "Clinical Trial, Phase III", "Clinical Trial, Phase II", "Clinical Trial, Phase I",
                "Clinical Trial", "Observational Study", "Review", "Editorial", "Comment",
                "Case Reports", "Letter", "Journal Article"):
        if key in pubtypes:
            study_type = PUBTYPE_LABELS[key]
            break

    mesh = [text_of(n) for n in node.findall(".//MeshHeadingList/MeshHeading/DescriptorName")]
    mesh = [m for m in mesh if m]

    citation = build_citation(node, journal_node)
    date = parse_pubdate(node)

    return {
        "pmid": pmid,
        "journal": JOURNALS[medline_ta],
        "journal_abbr": medline_ta,
        "title_en": title_en,
        "title_zh": "",
        "summary_en": abstract[:800],
        "summary_zh": "",
        "conclusion_en": conclusion[:400],
        "citation": citation,
        "link": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "date": date,
        "authors": ", ".join(authors[:6]),
        "author_count": len(authors),
        "doi": doi,
        "study_type": study_type,
        "pubtypes": pubtypes[:4],
        "mesh": mesh[:10],
    }


def build_citation(node: ET.Element, journal_node: ET.Element | None) -> str:
    """构造 GB/T 7714 风格的引文：刊名. 年;卷(期):页."""
    source = text_of(node.find(".//MedlineJournalInfo/MedlineTA"))
    year = text_of(node.find(".//JournalIssue/PubDate/Year"))
    volume = text_of(node.find(".//JournalIssue/Volume"))
    issue = text_of(node.find(".//JournalIssue/Issue"))
    pages = text_of(node.find(".//Pagination/MedlinePgn")) or text_of(node.find(".//Pagination/StartPage"))
    if not year and journal_node is not None:
        year = text_of(journal_node.find("PubDate/Year"))

    head = f"{source}. " if source else ""
    locator = f"{year}" if year else ""
    if volume:
        locator += f"; {volume}"
        if issue:
            locator += f"({issue})"
        if pages:
            locator += f": {pages}"
    elif pages:
        locator += f": {pages}"
    return (head + locator).strip().rstrip(";:")


# --------------------------------------------------------------------------- #
# 分类与中文导读
# --------------------------------------------------------------------------- #

def classify(mesh: list[str], pubtypes: list[str], title: str) -> list[str]:
    """先按 MeSH 主题词判定科室，缺失时用标题关键词兜底。"""
    def match(haystack: str) -> list[str]:
        hits: list[str] = []
        for keyword, dept in DEPT_RULES:
            if keyword in haystack and dept not in hits:
                hits.append(dept)
        return hits

    hits = match(" ".join(mesh).lower())
    if not hits:
        hits = match(title.lower())
    return hits[:3] or ["综合"]


def build_summary_zh(article: dict[str, Any]) -> str:
    """不依赖翻译模型的中文导读：类型 + 主要结论的定位提示。"""
    study_type = article.get("study_type") or "研究论文"
    journal = article.get("journal_abbr") or article.get("journal") or ""
    conclusion = article.get("conclusion_en", "")

    numbers: list[str] = []
    for pattern in (r"\b\d[\d,\.]*\s*%", r"\bN\s*=\s*\d[\d,]*", r"\b(?:HR|OR|RR|CI|P)\s*[<=>]\s*[\d\.]+"):
        numbers.extend(re.findall(pattern, conclusion, re.I))
    numbers = list(dict.fromkeys(n.strip() for n in numbers))[:4]

    lead = f"【{study_type}】{journal} 刊载。"
    if numbers:
        lead += "关键数据：" + "、".join(numbers) + "。"
    if conclusion:
        lead += "结论要点见下方原文摘要。"
    else:
        lead += "原文未附结构化摘要。"
    return lead


# --------------------------------------------------------------------------- #
# 翻译（带缓存与配额预算）
# --------------------------------------------------------------------------- #

def load_cache() -> dict[str, str]:
    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {k: v for k, v in data.items() if isinstance(v, str) and v}
        except json.JSONDecodeError:
            log.warning("翻译缓存损坏，将重建")
    return {}


def cache_key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def save_cache(cache: dict[str, str]) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")


def translate(text: str, cache: dict[str, str], state: dict[str, Any]) -> str:
    """MyMemory 翻译，命中缓存直接返回；预算耗尽或连续失败后停止请求。"""
    text = (text or "").strip()
    if not text:
        return ""
    key = cache_key(text)
    if key in cache:
        return cache[key]
    if state["budget"] <= 0 or state["fails"] >= 5:
        return ""

    params = {"q": text[:480], "langpair": "en|zh-CN"}
    if MYMEMORY_EMAIL:
        params["de"] = MYMEMORY_EMAIL
    try:
        payload = http_get(TRANSLATE_ENDPOINT, params, tries=2, timeout=20).json()
        state["budget"] -= 1
        translated = ((payload.get("responseData") or {}).get("translatedText") or "").strip()
        if payload.get("responseStatus") != 200 or not translated:
            state["fails"] += 1
            return ""
        if re.search(r"MYMEMORY WARNING|INVALID|QUERY LENGTH", translated, re.I):
            state["fails"] += 1
            return ""
        if len(translated) < max(8, len(text) * 0.25):
            state["fails"] += 1
            return ""
        state["fails"] = 0
        cache[key] = translated
        time.sleep(0.6)  # 主动限速，避免触发 429
        return translated
    except Exception as exc:  # noqa: BLE001 - 翻译失败不应中断整批采集
        state["fails"] += 1
        log.warning("翻译失败（连续 %s 次）：%s", state["fails"], exc)
        return ""


# --------------------------------------------------------------------------- #
# 数据读写
# --------------------------------------------------------------------------- #

def load_existing_articles() -> list[dict[str, Any]]:
    if not NEWS_FILE.exists():
        return []
    try:
        payload = json.loads(NEWS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("现有 news.json 损坏，忽略")
        return []
    if payload.get("schema_version", 1) < SCHEMA_VERSION:
        log.info("检测到旧版数据结构，本次全量重建")
        return []
    articles = payload.get("articles")
    return articles if isinstance(articles, list) else []


def merge_articles(existing: list[dict[str, Any]], incoming: list[dict[str, Any]],
                   window_days: int) -> list[dict[str, Any]]:
    cutoff = (utc_now().date() - timedelta(days=window_days)).isoformat()
    merged: dict[str, dict[str, Any]] = {}

    for article in existing:
        pmid = str(article.get("pmid") or "")
        if not pmid:
            continue
        if article.get("date") and article["date"] < cutoff:
            continue
        merged[pmid] = article

    for article in incoming:
        pmid = article["pmid"]
        previous = merged.get(pmid, {})
        if previous.get("title_zh"):
            article["title_zh"] = previous["title_zh"]
        merged[pmid] = article

    return sorted(merged.values(), key=lambda a: (a.get("date") or "", a.get("pmid") or ""), reverse=True)


def write_archive(articles: list[dict[str, Any]]) -> None:
    """按月归档，只保留题录核心字段，便于回溯且控制体积。"""
    core_fields = ("pmid", "journal", "journal_abbr", "title_en", "title_zh",
                   "citation", "link", "date", "authors", "doi", "study_type",
                   "departments")

    def slim(article: dict[str, Any]) -> dict[str, Any]:
        return {key: article[key] for key in core_fields if article.get(key)}

    buckets: dict[str, list[dict[str, Any]]] = {}
    for article in articles:
        month = (article.get("date") or "")[:7]
        if not month:
            continue
        buckets.setdefault(month, []).append(slim(article))

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    for month, items in buckets.items():
        path = ARCHIVE_DIR / f"{month}.json"
        existing: dict[str, dict[str, Any]] = {}
        if path.exists():
            try:
                for item in json.loads(path.read_text(encoding="utf-8")).get("articles", []):
                    if item.get("pmid"):
                        existing[item["pmid"]] = slim(item)
            except (json.JSONDecodeError, AttributeError):
                existing = {}
        for item in items:
            existing[item["pmid"]] = item
        payload = {
            "schema_version": SCHEMA_VERSION,
            "month": month,
            "count": len(existing),
            "articles": sorted(existing.values(), key=lambda a: a.get("date") or "", reverse=True),
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def write_feed(articles: list[dict[str, Any]], site_url: str) -> None:
    from email.utils import format_datetime
    from xml.sax.saxutils import escape

    def rfc822(date_str: str) -> str:
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            return format_datetime(dt)
        except ValueError:
            return format_datetime(utc_now())

    items = []
    for article in articles[:50]:
        title = escape(article.get("title_zh") or article.get("title_en") or "")
        desc = escape(article.get("summary_zh") or article.get("summary_en") or "")[:300]
        link = escape(article["link"])
        items.append(
            "    <item>\n"
            f"      <title>{title}</title>\n"
            f"      <link>{link}</link>\n"
            f"      <guid isPermaLink=\"true\">{link}</guid>\n"
            f"      <pubDate>{rfc822(article.get('date') or '')}</pubDate>\n"
            f"      <description>{desc}</description>\n"
            "    </item>"
        )
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0">\n'
        "  <channel>\n"
        "    <title>永遠亭 医療報告</title>\n"
        f"    <link>{escape(site_url)}</link>\n"
        "    <description>八意永琳编制的权威医学期刊速报</description>\n"
        "    <language>zh-TW</language>\n"
        f"    <lastBuildDate>{format_datetime(utc_now())}</lastBuildDate>\n"
        + "\n".join(items) +
        "\n  </channel>\n</rss>\n"
    )
    FEED_FILE.write_text(feed, encoding="utf-8")


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #

def collect(days: int) -> tuple[list[dict[str, Any]], list[str]]:
    articles: list[dict[str, Any]] = []
    failures: list[str] = []

    for abbr, full in JOURNALS.items():
        try:
            pmids = esearch(abbr, days)
            log.info("%-16s 命中 %s 篇", abbr, len(pmids))
            if not pmids:
                continue
            for node in efetch(pmids):
                parsed = parse_article(node)
                if parsed:
                    articles.append(parsed)
        except Exception as exc:  # noqa: BLE001 - 单刊失败不影响其余期刊
            log.error("%s 采集失败：%s", abbr, exc)
            failures.append(f"{abbr}: {exc}")

    return articles, failures


def enrich(articles: list[dict[str, Any]], budget: int, skip_translate: bool = False) -> dict[str, Any]:
    cache = load_cache()
    state: dict[str, Any] = {"budget": 0 if skip_translate else budget, "fails": 0}
    started = time.time()

    # 优先翻译最近两周的标题，其余条目保留英文标题
    today = utc_now().date()
    recent_cutoff = (today - timedelta(days=14)).isoformat()
    ordered = sorted(articles, key=lambda a: a.get("date") or "", reverse=True)
    recent = [a for a in ordered if (a.get("date") or "") >= recent_cutoff]
    older = [a for a in ordered if (a.get("date") or "") < recent_cutoff]

    for article in recent + older:
        translated = translate(article["title_en"], cache, state)
        if translated:
            article["title_zh"] = translated
        article["departments"] = classify(article.get("mesh", []), article.get("pubtypes", []), article["title_en"])
        article["summary_zh"] = build_summary_zh(article)

    if state["budget"] < budget:
        save_cache(cache)

    log.info(
        "翻译配额使用 %s/%s，连续失败 %s 次，缓存条目 %s，耗时 %.0fs",
        budget - state["budget"], budget, state["fails"], len(cache), time.time() - started,
    )
    return {"translate_used": budget - state["budget"], "cache_size": len(cache), "translate_fails": state["fails"]}


def main() -> int:
    parser = argparse.ArgumentParser(description="永遠亭 医療報告 数据采集器")
    parser.add_argument("--days", type=int, default=WINDOW_DAYS, help="采集窗口（天）")
    parser.add_argument("--full", action="store_true", help="忽略本地数据，全量重建")
    parser.add_argument("--budget", type=int, default=TRANSLATE_BUDGET, help="本次翻译预算（条）")
    parser.add_argument("--no-translate", action="store_true", help="跳过在线翻译，仅复用缓存")
    parser.add_argument("--site-url", default="https://kasilovsky.github.io/eirin-report/",
                        help="站点根地址，用于 RSS 链接")
    args = parser.parse_args()

    log.info("采集窗口 %s 天，期刊 %s 种", args.days, len(JOURNALS))
    incoming, failures = collect(args.days)
    log.info("本次抓取 %s 篇，失败期刊 %s 个", len(incoming), len(failures))

    if not incoming:
        log.error("未抓取到任何文献，保留现有数据不覆盖")
        return 1

    existing = [] if args.full else load_existing_articles()
    merged = merge_articles(existing, incoming, args.days)
    stats = enrich(merged, args.budget, skip_translate=args.no_translate)

    # 仅内部使用、不进入静态数据的字段
    for article in merged:
        article.pop("conclusion_en", None)
        article.pop("pubtypes", None)

    counts: dict[str, int] = {}
    for article in merged:
        counts[article["journal_abbr"]] = counts.get(article["journal_abbr"], 0) + 1

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now().astimezone().isoformat(timespec="seconds"),
        "window_days": args.days,
        "count": len(merged),
        "journals": [{"abbr": abbr, "name": full, "count": counts.get(abbr, 0)}
                     for abbr, full in JOURNALS.items()],
        "failures": failures,
        "stats": stats,
        "articles": merged,
    }

    NEWS_FILE.parent.mkdir(parents=True, exist_ok=True)
    NEWS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    write_archive(merged)
    write_feed(merged, args.site_url)

    size_kb = NEWS_FILE.stat().st_size / 1024
    log.info("已写入 %s 篇 -> %s (%.0f KB)", len(merged), NEWS_FILE, size_kb)
    if failures:
        log.warning("以下期刊本次失败：%s", "; ".join(failures))
    return 0


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    raise SystemExit(main())
