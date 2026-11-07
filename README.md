# 永遠亭 医療報告

每天从 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 采集七种权威医学期刊的近期文献，生成「每日要目」与可检索的文献索引，发布为静态站点。

线上站点：<https://kasilovsky.github.io/eirin-report/>

---

## 一、快速上手

### 改刊首语（八意永琳的台词）

1. 双击桌面上的 **「刊首語編輯器」**（或运行 `python edit_server.py`）
2. 浏览器打开 <http://127.0.0.1:8766/>
3. 改文字 → 点 **「保存」**（只改本地，可反复预览）
4. 满意后点 **「保存並發布」** → 自动 commit + push → 约 1 分钟后线上生效

编辑器底部状态栏会显示同步状态：

| 显示 | 含义 |
|---|---|
| `已同步` | 本地与 GitHub 一致 |
| `本地有未保存改动` | 改了还没保存/发布 |
| `未推送 N 个提交` | 已提交，但还没推到 GitHub |
| `远端新 N 个提交` | GitHub 上有新提交，先别发布，需要先合并 |

### 手动跑一次数据

```bash
python crawler.py        # 采集 PubMed → data/news.json + feed.xml
python translate_llm.py  # 用大模型翻译标题
python digest.py         # 生成每日要目 → data/digest/
```

### 本地预览站点

```bash
python -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

---

## 二、文件说明

### 页面（静态，部署到 GitHub Pages）

| 文件 | 作用 |
|---|---|
| `index.html` | 首页：刊首语、要目入口、文献检索（搜索/期刊/科室/时间筛选） |
| `digest.html` | 本期要目页：十则研究的一句话结论、关键数据、意义 |
| `discuss.html` | 竹林茶会：公告区（读 GitHub Issues）+ 留言板（暂未开放） |
| `rss.html` | RSS 订阅说明页：订阅地址、阅读器用法 |
| `assets/style.css` | 全站样式（纸本期刊风格，明暗双主题） |
| `assets/app.js` | 首页逻辑：检索、筛选、分页、复制、导出 |
| `assets/digest.js` | 要目页逻辑：读取 `data/digest/latest.json` 并渲染 |
| `assets/discuss.js` | 茶会页逻辑：读取 GitHub Issues 里作者为 Kasilovsky 的公告 |
| `assets/icon.svg` | 站点图标（月牙 + 竹） |
| `assets/icon-192.png` / `icon-512.png` | PWA 图标 |
| `assets/editor.ico` | 编辑器桌面快捷方式图标（月牙 + 笔） |
| `manifest.json` | PWA 清单（可安装到桌面） |
| `sw.js` | Service Worker，离线缓存（相对路径，适配子目录） |

### 数据（`data/`）

| 文件 | 作用 |
|---|---|
| `data/news.json` | 文献索引（当前窗口 180 天，约 720 条），前端唯一数据源 |
| `data/digest/latest.json` | 最新一期要目（10 条解读） |
| `data/digest/YYYY-MM-DD.json` | 按期归档的要目 |
| `data/forewords.json` | 刊首语配置：`index` 首页轮换 20 条、`discuss` 茶会页那句 |
| `data/i18n_cache.json` | 标题翻译缓存（跨天复用，避免重复请求） |
| `data/archive/YYYY-MM.json` | 按月归档的题录（只留核心字段） |
| `feed.xml` | RSS 订阅源（由 digest.py 生成，10 条要目） |
| `feed.xsl` | RSS 的浏览器渲染样式（Chrome 将弃用 XSLT，仅作兼容） |

### 脚本（Python）

| 文件 | 作用 |
|---|---|
| `crawler.py` | 采集器：PubMed 检索 → 解析 → 分类 → 翻译 → 写 news.json / archive / feed |
| `translate_llm.py` | 索引层标题的 LLM 翻译（比 MyMemory 准，覆盖 99%） |
| `digest.py` | 要目生成：筛选一手研究 → 补抓完整摘要 → LLM 写解读 → 写 digest + feed |
| `discuss_post.py` | 每天用 GITHUB_TOKEN 自动开讨论帖（按日期去重） |
| `edit_server.py` | **本地刊首语编辑器**（见下方详解） |
| `start-editor.bat` | 双击启动编辑器（已在运行则只打开浏览器） |

### CI / 配置

| 文件 | 作用 |
|---|---|
| `.github/workflows/daily.yml` | 每日 UTC 01:00 自动采集、翻译、生成要目、提交、开帖 |
| `.github/ISSUE_TEMPLATE/01-bug.yml` | 「报告错误」反馈表单 |
| `.github/ISSUE_TEMPLATE/02-suggestion.yml` | 「选题建议」表单 |
| `.gitignore` | 忽略 `.tmp/`、`.env`、`worker/.wrangler/` 等 |
| `requirements.txt` | Python 依赖（仅 `requests`） |
| `worker/` | 预留的 Cloudflare Worker 留言板后端（国内不可达，未启用） |

---

## 三、刊首语编辑器（`edit_server.py`）

本地小工具，只监听 `127.0.0.1`，不对外。

```
双击 start-editor.bat
  ↓
启动 edit_server.py（8766 端口）
  ↓
浏览器打开 http://127.0.0.1:8766/
```

提供的操作：

- 编辑 `index` 的每一条（文本框直接改）
- `↑ ↓` 调整顺序、`删` 删除、`＋ 新增一條` 添加
- 编辑 `discuss` 字段（茶会页那句）
- **保存**：写回 `data/forewords.json`，站点刷新即生效
- **保存並發布**：写回 + `git commit` + `git push`（推送失败自动重试 3 次）
- 状态栏显示同步状态（见上方表格）

只改 `data/forewords.json` 这一个文件，不会动其他内容。

---

## 四、数据流

```
PubMed esearch ──▶ 按刊检索近 180 天（每刊至多 100 条）
      ↓
PubMed efetch  ──▶ 标题、摘要、作者、DOI、MeSH、卷期页
      ↓
crawler.py     ──▶ 解析、MeSH 分类、PubDate 定日期、增量合并（以 PMID 为主键）
      ↓
translate_llm.py ─▶ LLM 翻译标题（失败保留原文，不影响流程）
      ↓
digest.py      ──▶ 筛选一手研究 → 完整摘要 → LLM 写解读 → data/digest/
      ↓
GitHub Actions ──▶ commit + push → Pages 部署
```

---

## 五、部署

推送到 `main` 后由 GitHub Pages 自动发布。每日 UTC 01:00（北京时间 09:00）由 Actions 执行采集，也可在 Actions 页面手动触发。

需要的仓库 Secret：

| 名称 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | 要目解读 + 标题翻译（未配置时自动降级为题录模式） |

`GITHUB_TOKEN` 是 Actions 内置的，用于提交数据与开讨论帖。

---

## 六、常见问题

**页面停在「正在調閱」？**
多半是浏览器缓存了旧 JS。资源引用带 `?v=` 版本号，硬刷新（Ctrl+F5）即可。

**编辑器打不开？**
确认 `python edit_server.py` 在运行，且 8766 端口没被占用。

**发布时提示推送失败？**
网络对 GitHub 的连接不稳定，重试即可；编辑器会自动重试 3 次。

**留言板？**
预留了 `worker/`（Cloudflare）后端，但 `workers.dev` 在国内被 DNS 污染无法访问，暂未启用。

---

## 七、免责声明

本站仅汇总公开文献的题录与摘要信息，供医学信息检索与交流参考，不构成诊疗建议。临床决策请以期刊原文与现行临床指南为准。
