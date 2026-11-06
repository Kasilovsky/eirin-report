# 永远亭医疗报告 · 自动采集与发布

每天从 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 采集七种权威医学期刊的近期文献，
生成静态站点所需的索引数据、按月归档与 RSS 订阅源；并用大模型把一手研究改写成
面向普通读者的「每日要目」。

线上站点：<https://kasilovsky.github.io/eirin-report/>

## 两层产物

| 层 | 内容 | 面向 |
| --- | --- | --- |
| 每日要目 `data/digest/` | 3–10 条一手研究的结论、关键数字、意义 | 没有医学训练但想读懂进展的人 |
| 全量索引 `data/news.json` | 700 条题录，可检索、筛选、导出 | 需要查阅原文的读者 |

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
├── digest.py                  要目生成器：筛选一手研究 → 大模型解读 → data/digest/
├── data/
│   ├── news.json              当前窗口（180 天）的文献索引，前端唯一数据源
│   ├── digest/                每日要目（latest.json + 按日期归档）
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

## 每日要目与模型注入（暗门）

`digest.py` 从索引里筛出最近 3 天的一手研究（RCT / Meta / 三期 / 指南），
排除社论、通信、勘误、病例报告，补抓**完整摘要**后交给大模型，
输出结论、关键数字、意义与证据等级，写入 `data/digest/`。

模型接口走 OpenAI 兼容协议，默认 DeepSeek。**密钥只从环境变量读取，从不写进仓库文件。**

三种注入方式，任选其一：

| 场景 | 做法 |
| --- | --- |
| 本地 | 在项目根目录放 `.env`（已被 `.gitignore` 忽略），写 `DEEPSEEK_API_KEY=...` |
| 本地临时 | `$env:DEEPSEEK_API_KEY="..."` 后运行 `python digest.py` |
| CI | 仓库 Settings → Secrets and variables → Actions 添加 `DEEPSEEK_API_KEY` |

三个开关（`EIRIN_LLM_MODE`）：

| 值 | 行为 |
| --- | --- |
| `auto`（默认） | 有密钥就调用模型；没有则降级为题录模式 |
| `off` | 强制题录模式，不产生任何网络请求 |
| `force` | 要求必须有密钥，缺失时直接报错退出 |

其他可覆盖项：`LLM_BASE_URL`（默认 `https://api.deepseek.com/v1`）、`LLM_MODEL`（默认 `deepseek-chat`）、
`--days` / `--limit` / `--no-llm`。

**降级不打折**：无密钥或调用失败时，产物标记 `degraded: true`，页面明确写出
「本期未启用模型解读，以下仅为题录」，不会把机翻伪装成解读。

**不编造**：提示词限定模型只能依据摘要原文，数字必须与原文一致；摘要没给结论时，
该条标为「证据等级：低」并写明「摘要未给出结果」。

成本参考：每天 10 条候选约 2–3 万 token，按 DeepSeek 价格折算约几分钱。

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
