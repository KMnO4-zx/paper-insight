<div align='center'>

<img src="./images/head.png" alt="Paper Insight" width="90%">
<h1><a href="https://paper-insight.herobase.tech">Paper Insight</a></h1>

English | [简体中文](./README.md)

</div>

## Introduction

Paper Insight is a fast paper-screening and analysis tool for AI conference papers. It uses LLMs to generate concise paper summaries, helping you decide whether a paper is worth reading in depth before saving it to Zotero or continuing with a deeper review.

I firmly believe that no great paper should have its close reading replaced by AI; we still need to understand its details and subtleties ourselves. Paper Insight's goal is to make the initial screening step faster, so you can more efficiently find candidates worth reading in depth from a large volume of papers.

Online demo:

https://paper-insight.herobase.tech

Currently supported:

- [ICLR 2026](https://paper-insight.herobase.tech/conference/iclr_2026)
- [CHI 2026](https://paper-insight.herobase.tech/conference/chi_2026)
- [NeurIPS 2025](https://paper-insight.herobase.tech/conference/neurips_2025)
- [ICML 2025](https://paper-insight.herobase.tech/conference/icml_2025)
- [Hugging Face Daily Papers](https://paper-insight.herobase.tech/hf-daily)

## Why This Exists

> *The starting point was simple: my advisor said that good ideas and insights come from reading enough papers, and I agree. I first built a Dify + Feishu workflow for paper reading, but it still required manually entering one paper at a time. Then I made several repositories to batch collect AI conference papers, so I could browse them and jump into the Dify workflow. Later I felt Dify was too slow, so I vibed a faster tool, Paper Insight, to analyze papers locally, look at summaries, keywords, and related-work recommendations, then save promising papers to Zotero for close reading. After that, I got tired of creating a new repository every time a new conference appeared, so I wrote a general crawler and import flow. Finally, I wanted to browse conference papers directly in the tool, so I added conference pages with pagination and keyword search. Convenience really is the first productive force. If you like this project, a star is welcome.*

## Features

- Quick paper analysis: focuses on four screening questions: whether code is open-sourced, what task the paper solves, what metrics it uses, and why it improves over baseline.
- Conference browsing: browse conference papers with pagination, keyword search, and field filters.
- Paper chat: ask multi-turn questions based on paper content, with saved chat history.
- Personal paper library: track viewed and liked papers for later review.
- GitHub accounts: new users register through GitHub; legacy email/password accounts can still log in.
- Hugging Face Daily Papers: sync popular Daily Papers and queue them for analysis.
- Admin dashboard: manage users, view online metrics, and manually trigger Daily Papers sync.

## Difference From cool papers

[cool papers](https://papers.cool/) is an excellent paper-reading tool. The positioning is different:

| Dimension | Paper Insight | cool papers |
| --- | --- | --- |
| Positioning | Quick paper screening | Deep paper understanding |
| Use case | Decide whether a paper is worth reading | Understand one paper in depth |
| Core output | Code, task, metrics, baseline-oriented screening | Problem, method, experiments, background, future directions |
| Extra capabilities | Conference browsing, search, paper chat, personal records | Deep paper interpretation |

In short, Paper Insight helps you quickly find candidate papers from a large pool; cool papers helps you deeply understand a specific paper.

## Local Run

If you only want to try the product, use the online version.

For local development or self-hosting, see [develop.md](./develop.md). It covers PostgreSQL, `config.yaml`, GitHub OAuth, data import, and Docker/VPS deployment.

## Tech Stack

- Backend: FastAPI
- Frontend: React 19 + TypeScript + Vite
- Database: PostgreSQL 16
- Search: PostgreSQL Full Text Search
- Auth: GitHub OAuth + HTTP-only Cookie
- Paper content cache: local disk cache, not stored in the main database

## License

Apache 2.0 License

## Acknowledgements

Thanks to [StepFun](https://www.stepfun.com/) for providing token support, which made it possible for me to quickly analyze a large number of papers.
