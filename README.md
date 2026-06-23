<div align='center'>

<img src="./images/head.png" alt="Paper Insight research workflow" width="92%">
<h1><a href="https://paper-insight.herobase.tech">Paper Insight</a></h1>
<p><strong>AI 帮你快速初筛，把好论文留给自己精读</strong></p>
<p>Paper Insight 帮你快速抓住论文重点，识别代码开源情况、任务设置、评价指标与核心贡献，把真正值得深入阅读的论文留给你自己。</p>

<p>
  <a href="https://paper-insight.herobase.tech">在线体验</a> ·
  <a href="./develop.md">开发指南</a> ·
  <a href="./README_en.md">English</a>
</p>

</div>

## 项目介绍

Paper Insight 是一个面向 AI 会议论文的快速筛选与分析工具。它使用 LLM 对论文生成简洁分析，帮助你先判断一篇论文是否值得精读，再决定是否收藏到 Zotero 或继续深入阅读。

如果每天至少要读五篇论文，真正卡住人的往往不是打开 PDF，而是在大量候选里快速判断哪几篇值得投入精力。Paper Insight 试图把这个判断过程变成稳定、可复用的研究入口。

我始终认为，任何一篇优秀的论文都不应该由 AI 来替代精读，需要我们亲自去理解它的细节和精妙之处。Paper Insight 的目标是把“初筛”这一步做得更快，让你能更高效地在大量论文中找到值得精读的候选。

默认分析会优先回答 4 个研究筛选问题：

- 代码是否开源？
- 解决什么任务？
- 使用什么评估指标？
- 为什么优于 baseline？

## 为什么做这个项目

> *&emsp;&emsp;做这个工具的起因是，老师说要看足够多的论文才会有很好的 idea 或 insight ，我觉得很对。（感谢王老师的读论文 Prompt）所以用 dify 联合飞书做了工作流，但是每次只手动输入能看一篇；后来做了好几个仓库用于批量拉取AI会议的论文，这样我可以直接看然后跳转到 dify 工作流；再然后我觉得 dify 太慢了，于是 vibe 了一个更快的工具 paper insight，直接在本地就能快速分析论文，看看摘要、关键词、相关工作推荐等，觉得有潜力就收藏到zotero里精读；我又觉得每次新的会议出来我就得新搞一个仓库太麻烦了，于是写了一个通用的爬虫脚本，能批量导入会议论文；最后我觉得如果能直接在这个工具里浏览会议论文就更好了，于是又加了一个会议浏览的功能，支持分页和关键词搜索。so，果然省事才是第一生产力。如果你喜欢这个项目，欢迎点个star哦~*

## 当前入口

| 入口 | 用来做什么 |
| --- | --- |
| [ICLR 2026](https://paper-insight.herobase.tech/conference/iclr_2026) / [CHI 2026](https://paper-insight.herobase.tech/conference/chi_2026) / [CVPR 2026](https://paper-insight.herobase.tech/conference/cvpr_2026) / [NeurIPS 2025](https://paper-insight.herobase.tech/conference/neurips_2025) / [ICML 2025](https://paper-insight.herobase.tech/conference/icml_2025) | 按会议批量浏览论文，支持分页、关键词搜索和字段过滤 |
| [Hugging Face Daily Papers](https://paper-insight.herobase.tech/hf-daily) | 自动同步热门 Daily Papers，并进入同一套分析流程 |
| [arXiv 分析](https://paper-insight.herobase.tech/arxiv) | 粘贴 arXiv 链接或 ID，把新论文加入分析与收藏流程 |

## 核心能力

- 快速分析：围绕代码、任务、指标、baseline 给出更适合初筛的摘要。
- 会议浏览：把会议论文、Daily Papers 和 arXiv 入口收束到统一的研究工作台。
- 全文对话：基于论文正文进行多轮问答，并保存历史会话。
- 个人论文库：记录看过、点赞过的论文，便于后续回看和筛选。
- 账号与后台：支持 GitHub 登录、用户管理、在线指标和手动触发同步任务。

## 和 cool papers 的区别

[cool papers](https://papers.cool/) 是一个很优秀的论文阅读工具，两者定位不同：

| 对比维度 | Paper Insight | cool papers |
| --- | --- | --- |
| 定位 | 快速筛选论文 | 深度理解论文 |
| 适用场景 | 先判断是否值得精读 | 系统理解论文细节 |
| 核心输出 | 代码、任务、指标、baseline 等初筛信息 | 问题、方法、实验、背景、后续方向等完整解读 |
| 额外能力 | 会议浏览、搜索、论文对话、个人记录 | 深度论文解读 |

简单说，Paper Insight 更适合在大量论文中快速找候选，cool papers 更适合对单篇论文做深入理解。

## 推荐使用方式

1. 从会议列表、Hugging Face Daily Papers 或 arXiv 链接进入候选池。
2. 先看 4 个筛选问题，快速判断论文是否和当前研究方向有关。
3. 对有潜力的论文继续追问方法细节、实验设置、相关工作和可能的复现路径。
4. 把值得精读的论文标记下来，再进入 Zotero 或本地阅读流程。

Paper Insight 不试图替你读完论文，而是帮你把每天的论文筛选节奏稳定下来。

## 开发与部署

如果只是想体验，建议直接使用线上版本。

如果需要本地开发或自行部署，请查看 [develop.md](./develop.md)，里面包含 PostgreSQL、`config.yaml`、GitHub OAuth、数据导入和 Docker/VPS 部署说明。

## License

Apache 2.0 License

## 致谢

感谢 [StepFun](https://www.stepfun.com/) 提供 Token 支持，让我得以对大量论文进行快速分析。
