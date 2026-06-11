<div align='center'>

<img src="./images/head.png" alt="Paper Insight" width="90%">
<h1><a href="https://paper-insight.herobase.tech">Paper Insight</a></h1>

[English](./README_en.md) | 简体中文

</div>

## 项目介绍

Paper Insight 是一个面向 AI 会议论文的快速筛选与分析工具。它使用 LLM 对论文生成简洁分析，帮助你先判断一篇论文是否值得精读，再决定是否收藏到 Zotero 或继续深入阅读。

我始终认为，任何一篇优秀的论文都不应该由 AI 来替代精读，需要我们自己去理解它的细节和精妙之处。Paper Insight 的目标是把“初筛”这一步做得更快，让你能更高效地在大量论文中找到值得精读的候选。

在线体验：

https://paper-insight.herobase.tech

当前支持：

- [ICLR 2026](https://paper-insight.herobase.tech/conference/iclr_2026)
- [CHI 2026](https://paper-insight.herobase.tech/conference/chi_2026)
- [NeurIPS 2025](https://paper-insight.herobase.tech/conference/neurips_2025)
- [ICML 2025](https://paper-insight.herobase.tech/conference/icml_2025)
- [Hugging Face Daily Papers](https://paper-insight.herobase.tech/hf-daily)

## 为什么做这个项目

> *&emsp;&emsp;做这个工具的起因是，老师说要看足够多的论文才会有很好的 idea 或 insight ，我觉得很对。（感谢王老师的读论文 Prompt）所以用 dify 联合飞书做了工作流，但是每次只手动输入能看一篇；后来做了好几个仓库用于批量拉取AI会议的论文，这样我可以直接看然后跳转到 dify 工作流；再然后我觉得 dify 太慢了，于是 vibe 了一个更快的工具 paper insight，直接在本地就能快速分析论文，看看摘要、关键词、相关工作推荐等，觉得有潜力就收藏到zotero里精读；我又觉得每次新的会议出来我就得新搞一个仓库太麻烦了，于是写了一个通用的爬虫脚本，能批量导入会议论文；最后我觉得如果能直接在这个工具里浏览会议论文就更好了，于是又加了一个会议浏览的功能，支持分页和关键词搜索。so，果然省事才是第一生产力。如果你喜欢这个项目，欢迎点个star哦~*

## 功能

- 论文快速分析：优先回答 4 个初筛问题：代码是否开源、解决什么任务、使用什么评估指标、为什么优于 baseline。
- 会议论文浏览：按会议批量浏览论文，支持分页、关键词搜索和字段过滤。
- 论文对话：基于论文内容进行多轮问答，并保存历史会话。
- 个人论文库：记录看过、点赞过的论文，便于后续回看和筛选。
- GitHub 账号：新用户通过 GitHub 注册，旧邮箱密码账号仍可继续登录。
- Hugging Face Daily Papers：自动同步热门 Daily Papers，并进入分析流程。
- 管理员后台：支持用户管理、在线指标和手动触发 Daily Papers 同步。

## 和 cool papers 的区别

[cool papers](https://papers.cool/) 是一个很优秀的论文阅读工具，两者定位不同：

| 对比维度 | Paper Insight | cool papers |
| --- | --- | --- |
| 定位 | 快速筛选论文 | 深度理解论文 |
| 适用场景 | 先判断是否值得精读 | 系统理解论文细节 |
| 核心输出 | 代码、任务、指标、baseline 等初筛信息 | 问题、方法、实验、背景、后续方向等完整解读 |
| 额外能力 | 会议浏览、搜索、论文对话、个人记录 | 深度论文解读 |

简单说，Paper Insight 更适合在大量论文中快速找候选，cool papers 更适合对单篇论文做深入理解。

## 本地运行

如果只是想体验，建议直接使用线上版本。

如果需要本地开发或自行部署，请查看 [develop.md](./develop.md)，里面包含 PostgreSQL、`config.yaml`、GitHub OAuth、数据导入和 Docker/VPS 部署说明。

## 技术栈

- 后端：FastAPI
- 前端：React 19 + TypeScript + Vite
- 数据库：PostgreSQL 16
- 搜索：PostgreSQL Full Text Search
- 账号：GitHub OAuth + HTTP-only Cookie
- 论文正文缓存：本地磁盘缓存，不写入主数据库

## License

Apache 2.0 License

## 致谢

感谢 [StepFun](https://www.stepfun.com/) 提供 Token 支持，让我得以对大量论文进行快速分析。
