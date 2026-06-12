<div align='center'>

<img src="./images/readme-head.png" alt="Paper Insight research workflow" width="92%">
<h1><a href="https://paper-insight.herobase.tech">Paper Insight</a></h1>
<p><strong>Find the papers worth reading before you go deep.</strong></p>
<p>Built for a research rhythm of at least five papers a day: conference browsing, arXiv analysis, paper chat, and a personal reading library.</p>

<p>
  <a href="https://paper-insight.herobase.tech">Live demo</a> ·
  <a href="./develop.md">Developer guide</a> ·
  <a href="./README.md">简体中文</a>
</p>

</div>

## Introduction

Paper Insight is a fast paper-screening and analysis tool for AI conference papers. It uses LLMs to generate concise paper summaries, helping you decide whether a paper is worth reading in depth before saving it to Zotero or continuing with a deeper review.

If the goal is to read at least five papers a day, the bottleneck is often not opening PDFs; it is quickly deciding which candidates deserve real attention. Paper Insight turns that judgment step into a stable, reusable research entrypoint.

I firmly believe that no great paper should have its close reading replaced by AI; we still need to understand its details and subtleties ourselves. Paper Insight's goal is to make the initial screening step faster, so you can more efficiently find candidates worth reading in depth from a large volume of papers.

By default, each analysis focuses on four screening questions:

- Is the code open-sourced?
- What task does the paper solve?
- What evaluation metrics does it use?
- Why is it better than the baseline?

## Why This Exists

> *The starting point was simple: my advisor said that good ideas and insights come from reading enough papers, and I agree. I first built a Dify + Feishu workflow for paper reading, but it still required manually entering one paper at a time. Then I made several repositories to batch collect AI conference papers, so I could browse them and jump into the Dify workflow. Later I felt Dify was too slow, so I vibed a faster tool, Paper Insight, to analyze papers locally, look at summaries, keywords, and related-work recommendations, then save promising papers to Zotero for close reading. After that, I got tired of creating a new repository every time a new conference appeared, so I wrote a general crawler and import flow. Finally, I wanted to browse conference papers directly in the tool, so I added conference pages with pagination and keyword search. Convenience really is the first productive force. If you like this project, a star is welcome.*

## Current Entrypoints

| Entrypoint | What it is for |
| --- | --- |
| [ICLR 2026](https://paper-insight.herobase.tech/conference/iclr_2026) / [CHI 2026](https://paper-insight.herobase.tech/conference/chi_2026) / [CVPR 2026](https://paper-insight.herobase.tech/conference/cvpr_2026) / [NeurIPS 2025](https://paper-insight.herobase.tech/conference/neurips_2025) / [ICML 2025](https://paper-insight.herobase.tech/conference/icml_2025) | Browse conference papers with pagination, keyword search, and field filters |
| [Hugging Face Daily Papers](https://paper-insight.herobase.tech/hf-daily) | Sync popular Daily Papers and send them through the same analysis flow |
| [arXiv analysis](https://paper-insight.herobase.tech/arxiv) | Paste an arXiv link or ID to add a new paper to the analysis and reading flow |

## Core Capabilities

- Quick analysis: summarizes code, task, metrics, and baseline-oriented evidence for faster screening.
- Research workspace: brings conference papers, Daily Papers, and arXiv into one flow.
- Paper chat: ask multi-turn questions based on paper content, with saved chat history.
- Personal paper library: track viewed and liked papers for later review.
- Accounts and admin: supports GitHub login, user management, online metrics, and manual sync jobs.

## Difference From cool papers

[cool papers](https://papers.cool/) is an excellent paper-reading tool. The positioning is different:

| Dimension | Paper Insight | cool papers |
| --- | --- | --- |
| Positioning | Quick paper screening | Deep paper understanding |
| Use case | Decide whether a paper is worth reading | Understand one paper in depth |
| Core output | Code, task, metrics, baseline-oriented screening | Problem, method, experiments, background, future directions |
| Extra capabilities | Conference browsing, search, paper chat, personal records | Deep paper interpretation |

In short, Paper Insight helps you quickly find candidate papers from a large pool; cool papers helps you deeply understand a specific paper.

## Suggested Flow

1. Start from a conference page, Hugging Face Daily Papers, or an arXiv link.
2. Read the four screening answers first to decide whether the paper matches your current direction.
3. For promising papers, ask follow-up questions about method details, experiments, related work, and possible reproduction paths.
4. Mark the papers worth reading, then move them into Zotero or your local close-reading workflow.

Paper Insight is not meant to read the paper for you; it is meant to make the daily screening rhythm easier to keep.

## Development

If you only want to try the product, use the online version.

For local development or self-hosting, see [develop.md](./develop.md). It covers PostgreSQL, `config.yaml`, GitHub OAuth, data import, and Docker/VPS deployment.

## License

Apache 2.0 License

## Acknowledgements

Thanks to [StepFun](https://www.stepfun.com/) for providing token support, which made it possible for me to quickly analyze a large number of papers.
