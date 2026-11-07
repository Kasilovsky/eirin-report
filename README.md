# 永遠亭 医療報告

> Eirin Medical Bulletin — 一个每日医学文献速报的静态站点。

从 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 采集七种权威医学期刊的近期文献，生成面向普通读者的「每日要目」和可检索的文献索引，以纯静态方式发布。

线上站点：<https://kasilovsky.github.io/eirin-report/>

## 内容

- **每日要目**：从一手研究中筛选，用模型生成一句话结论、关键数据与意义，标明证据等级
- **文献索引**：按期刊、科室、时间筛选，支持检索与原文跳转
- **RSS 订阅**：订阅每日要目
- **竹林茶會**：以 GitHub Issues 为载体的公告板

收录期刊：

| 缩写 | 期刊 |
| --- | --- |
| N Engl J Med | New England Journal of Medicine |
| Lancet | The Lancet |
| JAMA | JAMA |
| BMJ | BMJ |
| Nat Med | Nature Medicine |
| Cell | Cell |
| Sci Transl Med | Science Translational Medicine |

## 技术栈

- 前端：原生 HTML / CSS / JavaScript，无框架、无构建步骤，由 GitHub Pages 托管
- 数据：Python 脚本（`requests`）采集与处理，GitHub Actions 每日定时运行
- 存储：全部数据以 JSON 静态文件形式随仓库发布

## 目录

```
.
├── index.html / digest.html / discuss.html / rss.html   页面
├── assets/                                              样式、脚本与图标
├── crawler.py                                           PubMed 采集
├── translate_llm.py                                     标题翻译
├── digest.py                                            每日要目生成
├── discuss_post.py                                      讨论帖
├── data/                                                JSON 数据（索引、要目、归档、翻译缓存）
├── feed.xml / feed.xsl                                  RSS 与样式
├── worker/                                              预留的留言板后端（未启用）
└── .github/workflows/daily.yml                          每日自动任务
```

## 部署

推送到 `main` 后由 GitHub Pages 自动发布。

每日任务依赖一个仓库 Secret：

| 名称 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 要目解读与标题翻译；未配置时自动降级为题录模式 |

## 数据来源与许可

文献题录与摘要来自 PubMed / NCBI，版权归原作者与出版方所有。本站仅做信息汇总与中文导读，不提供原文全文。

## 免责声明

本站内容仅供医学信息检索与交流参考，不构成诊疗建议。
临床决策请以期刊原文与现行临床指南为准。
该项目仅为个人项目。
