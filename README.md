# 永远亭医疗报告 · 自动采集与发布

每天从 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 采集七种权威医学期刊的近期文献，
生成静态站点所需的索引数据、按月归档与 RSS 订阅源。

线上站点：<https://kasilovsky.github.io/eirin-report/>

## 收录期刊

| 缩写 | 期刊 |
| --- | --- |
| N Engl J Med | New England Journal of Medicine |
| Lancet | The Lancet |
| JAMA | JAMA |
| BMJ | BMJ |
| Nat Med | Nature Medicine |
| Cell | Cell |
| Sci Transl Med | Science Translational Medicine |

## 项目结构

```
.
├── index.html                 报告主页面（检索、筛选、导出）
├── discuss.html               竹林茶会（GitHub Issues 索引，不含任何凭据）
├── assets/
│   ├── style.css              排版样式（纸本期刊风格，明暗双主题）
│   ├── app.js                 主页面逻辑（无框架、无依赖）
│   ├── discuss.js             讨论页逻辑
│   ├── icon.svg               站点图标
│   ├── icon-192.png           PWA 图标
│   └── icon-512.png           PWA 图标
├── crawler.py                 采集器：PubMed → 分类 → 翻译 → JSON/RSS
├── data/
│   ├── news.json              当前窗口（180 天）的文献索引，前端唯一数据源
│   ├── i18n_cache.json        标题翻译缓存（跨天复用，需提交）
│   └── archive/YYYY-MM.json   按月归档，便于回溯
├── feed.xml                   RSS 2.0 订阅源
├── sw.js                      Service Worker（离线缓存，相对路径）
├── manifest.json              PWA 清单
└── .github/workflows/daily.yml 每日自动采集
```

## 数据流

```
PubMed esearch  →  按刊检索近 180 天，每刊至多 100 条
      ↓
PubMed efetch   →  一次取回标题、摘要、作者、DOI、MeSH、卷期页
      ↓
解析与分类      →  MeSH 主题词映射科室，PubDate 决定出版日期
      ↓
翻译与增量合并  →  标题翻译走缓存 + MyMemory，以 PMID 为主键 upsert
      ↓
写出            →  data/news.json、data/archive、feed.xml
```

## 本地运行

```bash
pip install -r requirements.txt
python crawler.py              # 增量更新
python crawler.py --full       # 忽略本地数据，全量重建
python crawler.py --days 30    # 只采集最近 30 天
python crawler.py --no-translate  # 跳过在线翻译，仅复用缓存
```

页面需要 HTTP 环境（`fetch` 无法读取 `file://`）：

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

## 翻译策略

标题翻译按以下优先级处理，任何一步失败都不会清空已有译文：

1. 命中 `data/i18n_cache.json` → 直接使用（跨天复用，日常几乎零请求）；
2. 未命中 → MyMemory 免费接口，按预算（默认 300 条/次）与 0.6 秒间隔逐步补齐；
3. 连续失败 5 次即熔断，保留英文标题，等待下次运行继续。

因此首次部署时中文标题较少，随着缓存累积会逐日覆盖。页面同时展示中英标题，
未译条目显示原文，不做占位替换。

## 数据结构（schema_version: 2）

```jsonc
{
  "schema_version": 2,
  "generated_at": "2026-11-07T03:00:00+08:00",
  "window_days": 180,
  "count": 700,
  "journals": [{ "abbr": "Lancet", "name": "The Lancet", "count": 100 }],
  "failures": [],
  "stats": { "translate_used": 120, "cache_size": 120, "translate_fails": 0 },
  "articles": [
    {
      "pmid": "42956796",
      "journal": "The Lancet",
      "journal_abbr": "Lancet",
      "title_en": "…",
      "title_zh": "…",
      "summary_en": "…",
      "summary_zh": "【Meta 分析】Lancet 刊载。…",
      "citation": "Lancet. 2026; 408(10567): 1953-1968",
      "link": "https://pubmed.ncbi.nlm.nih.gov/42956796/",
      "date": "2026-11-07",
      "authors": "…",
      "author_count": 9,
      "doi": "10.1016/…",
      "study_type": "Meta 分析",
      "mesh": ["Myocardial Infarction", "…"],
      "departments": ["循环器"]
    }
  ]
}
```

## 部署

推送到 `main` 后由 GitHub Pages 自动发布。每日 UTC 01:00（北京时间 09:00）
由 Actions 运行采集并提交变更；也可在 Actions 页面手动触发。

采集失败时不会覆盖既有数据：脚本以 PMID 为键做合并，抓不到就直接保留上一次的内容。

## 免责声明

本站仅汇总公开文献的题录信息，供医学信息检索与交流参考，不构成诊疗建议。
临床决策请以期刊原文与现行临床指南为准。
