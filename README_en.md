<div align='center'>

<img src="./images/head.png" alt="alt text" width="90%">
<h1><a href="https://paper-insight.herobase.tech">Paper Insight</a></h1>

English | [简体中文](./README.md)

</div>

## 🎯 Project Introduction

&emsp;&emsp;Paper Insight is an online paper analysis tool built with FastAPI and PostgreSQL, leveraging LLM technology to provide fast paper analysis and interactive chat, helping researchers quickly understand and screen academic papers.

&emsp;&emsp;This project aims to assist in quickly browsing AI conference papers. Through AI-generated summaries, users can decide whether to save papers to Zotero for in-depth reading. Current data mainly comes from the supported conference import pipeline, and the UI is being kept platform-neutral so more paper sources can be introduced later.

***&emsp;&emsp;Visit https://paper-insight.herobase.tech for online experience, or follow the steps below for local deployment.***

&emsp;&emsp;Supported conferences: [ICLR 2026](https://paper-insight.herobase.tech/conference/iclr_2026), [NeurIPS 2025](https://paper-insight.herobase.tech/conference/neurips_2025), [ICML 2025](https://paper-insight.herobase.tech/conference/icml_2025)

&emsp;&emsp;Additional paper source: [Hugging Face Daily Papers](https://paper-insight.herobase.tech/hf-daily). The app can fetch the daily list from Hugging Face, store the top-liked papers, deduplicate them, and queue AI analysis automatically.

> *Note: the runtime default currently uses `StepLLM` and reads credentials from `config.yaml`. If you change LLM providers, check `backend/app.py` and `backend/llm.py` first.*

### 🤔 Why not [cool papers](https://papers.cool/)?

&emsp;&emsp;cool papers is an excellent paper reading tool developed by Su Jianlin, but the two tools have different design philosophies:

| Dimension | Paper Insight | cool papers |
|---------|--------------|-------------|
| **Positioning** | Quick paper screening | Deep paper understanding |
| **Analysis Questions** | 4 core questions | 6 detailed questions |
| **Core Questions** | • Is code open-sourced?<br>• What task does it solve?<br>• What evaluation metrics?<br>• Why better than baseline? | • What problem to solve?<br>• Related research?<br>• How to solve it?<br>• What experiments?<br>• Further exploration?<br>• Summary |
| **Use Case** | Quickly judge paper value, decide whether to read in-depth | Comprehensively understand paper details and research context |
| **Extra Features** | • Conference paper browsing<br>• Field-filtered search<br>• Paper chat<br>• User paper history | • Detailed paper interpretation<br>• Complete research background |

&emsp;&emsp;**In short**: Paper Insight focuses on "quick screening" to help you find papers worth reading in-depth from a large volume; cool papers focuses on "deep understanding" to help you comprehensively grasp all aspects of a paper. They complement each other—choose based on your needs.

## ✨ Features

### 📄 Paper Analysis
- **Quick Analysis**: Input an OpenReview paper ID, and AI answers four core questions: whether code is available, what task the paper solves, what metrics it uses, and why the method improves over baseline
- **Smart Caching**: Analysis results automatically saved to database, instant access on revisit
- **Re-analysis**: Support regenerating analysis results
- **Streaming Output**: Real-time display of AI analysis process, no waiting

### 🗂️ Conference Browsing
- **Batch Browsing**: Support all papers from NeurIPS 2025, ICLR 2026, and other conferences
- **Paginated Display**: 8 papers per page, support page jumping
- **Field-Filtered Search**: Search in title, abstract, or keywords to precisely locate target papers
- **Keyboard Shortcut**: Shift+Enter for quick search
- **Smart Caching**: 24-hour cache, instant access on revisit

### 🤗 Hugging Face Daily Papers
- **Scheduled Fetching**: Fetch `https://huggingface.co/api/daily_papers` every day at the configured local time
- **Top-liked Selection**: Store the top 5 papers by Hugging Face upvotes by default
- **Deduplication**: Use the Hugging Face / arXiv paper id as the stable source id to avoid duplicate paper records
- **Auto Analysis**: Newly imported papers are queued for AI analysis when the LLM is configured
- **Daily Display**: Browse Daily Papers by ingestion date, with same-day papers sorted by upvotes / rank

### 💬 Paper Chat
- **Intelligent Q&A**: Multi-turn conversation based on paper content
- **Context Memory**: Maintain conversation context, understand continuous questions
- **Chat History**: Automatically save chat history, view anytime
- **Regenerate**: Support regenerating the last reply

### 👤 Account & Personal Library
- **GitHub Registration**: New accounts are created only through GitHub OAuth
- **Legacy Password Login**: Existing email/password accounts can still log in; sessions are stored in HTTP-only cookies
- **Database-backed Marks**: Viewed and liked paper states are stored in PostgreSQL for future recommendation systems
- **My Papers Page**: View papers you have read or liked, with filters and sorting by viewed time, liked time, recent activity, or title
- **Authenticated Chat Ownership**: Paper chat history is bound to the logged-in account

### 🛠️ Admin Dashboard
- **Online Metrics**: Display current online users and historical trends
- **User Management**: List users, enable/disable accounts, reset user passwords, and delete users with confirmation
- **Admin Password**: Change the current administrator password from the dashboard
- **HF Daily Sync**: Manually trigger a Hugging Face Daily Papers sync from the dashboard

### 🔧 Other Features
- **Online Users**: Real-time display of current online user count
- **Centralized Config**: Runtime configuration is read from `config.yaml`; `config.yaml.example` is committed as the template
- **Batch Import**: Support batch importing conference papers from JSONL files
- **Responsive Design**: Support desktop and mobile access

## Quick Start

### 1. Install Dependencies

Backend dependencies:

```bash
uv sync
```

Frontend dependencies:

```bash
cd frontend-react
npm install
```

### 2. Prepare Local PostgreSQL 16

Using Homebrew on macOS:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb paper_online
```

### 3. Configure `config.yaml`

Copy the example config and fill in local values. `config.yaml` is gitignored and must not be committed.

```bash
cp config.yaml.example config.yaml
```

At minimum, verify:

```yaml
database:
  url: postgresql:///paper_online

llm:
  step_api_key: your_api_key_here

admin:
  email: admin@example.com
  initial_password: change-this-admin-password

auth:
  github_client_id: your_github_oauth_client_id
  github_client_secret: your_github_oauth_client_secret
  github_callback_url: http://127.0.0.1:8000/auth/github/callback
  frontend_base_url: http://127.0.0.1:5173

hf_daily:
  enabled: true
  api_url: https://huggingface.co/api/daily_papers
  fetch_time: "22:00"
  timezone: Asia/Shanghai
  top_n: 5
```

Initialize the database schema:

```bash
uv run python scripts/apply_migrations.py
```

The backend also applies SQL migrations automatically on startup, but running the script explicitly is useful when preparing a fresh local database.

For a minimal local dataset:

```bash
uv run python scripts/apply_migrations.py --seed dev
```

### 4. Start in Development Mode

Start the backend:

```bash
cd backend
uv run uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Start the React frontend in another terminal:

```bash
cd frontend-react
npm run dev
```

### 5. Access the Application

Development mode:
- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8000`

Recommended routes:
- Home: `http://127.0.0.1:5173/`
- Global search: `http://127.0.0.1:5173/search?q=agent`
- Conference page: `http://127.0.0.1:5173/conference/iclr_2026`
- Hugging Face Daily Papers: `http://127.0.0.1:5173/hf-daily`
- Paper detail: `http://127.0.0.1:5173/papers/uq6UWRgzMr`
- Login / register: `http://127.0.0.1:5173/login`, `http://127.0.0.1:5173/register`
- My papers: `http://127.0.0.1:5173/me`
- Admin dashboard: `http://127.0.0.1:5173/admin`

Search is triggered by clicking the search button or pressing `Shift+Enter`.
Legacy query-style URLs such as `/?id=...`, `/?conference=...`, and `/?search=...` are no longer supported.

## Stop Service

Press `Ctrl + C` in each terminal to stop the backend and frontend dev servers.

## 👩‍💻 Developer Guide

This section focuses on the three common local-development tasks:

1. Start / stop local PostgreSQL
2. Prepare the local development database
3. Prepare local development data

### 1. Start / stop local PostgreSQL

If you installed `postgresql@16` with Homebrew on macOS, these are the commands you will use most often:

```bash
# Start
brew services start postgresql@16

# Stop
brew services stop postgresql@16

# Restart
brew services restart postgresql@16

# Check status
brew services list | grep postgresql@16
```

You can also run PostgreSQL manually in the foreground, but for this repo `brew services` is the simplest path.

### 2. Prepare the local development database

Use `paper_online` as the default local database name:

```bash
# Run once
createdb paper_online

# Initialize tables, indexes, and search functions
uv run python scripts/apply_migrations.py
```

If you want to reset everything:

```bash
dropdb --if-exists paper_online
createdb paper_online
uv run python scripts/apply_migrations.py
```

### 3. Two ways to prepare local data

#### Option A: minimal dev seed

Good for booting the UI quickly and validating APIs without full production data.

```bash
uv run python scripts/apply_migrations.py --seed dev
```

#### Option B: rebuild from `crawled_data/`

Use this if you do not want to depend on the online dump, or if you want to rebuild / add conference data from crawler output.

First initialize the database:

```bash
uv run python scripts/apply_migrations.py
```

Then import by conference:

```bash
uv run python scripts/import_papers.py --conference neurips_2025
uv run python scripts/import_papers.py --conference iclr_2026
uv run python scripts/import_papers.py --conference icml_2025
```

Notes:

- Source directory is always `crawled_data/{conference}/`
- Import is overwrite-style per paper
- `papers` uses upsert
- `authors` and `keywords` are deleted then re-inserted for touched papers
- `llm_response` is not generated during import; it is filled later by user-triggered analysis or the background analyzer

### 4. Paper content disk cache

The paper body returned by Jina Reader is **not stored in PostgreSQL**. It is cached on disk under:

```text
data/paper_cache/
```

Current behavior:

- The first paper analysis fetches the PDF text from Jina Reader if the cache is missing
- The first chat-session initialization also fetches it if the cache is missing
- Once cached, analysis / chat / background analysis reuse the local text file

To force a fresh fetch, delete the cache directory:

```bash
rm -rf data/paper_cache
```

### 5. Hugging Face Daily Papers

The default config enables a daily sync:

```yaml
hf_daily:
  enabled: true
  api_url: https://huggingface.co/api/daily_papers
  fetch_time: "22:00"
  timezone: Asia/Shanghai
  top_n: 5
```

Behavior:

- The scheduler runs inside the FastAPI process.
- It fetches the Hugging Face Daily Papers API once per configured day.
- It stores the top-liked papers into `papers` and source metadata into `hf_daily_papers`.
- New papers remain with `llm_response IS NULL` until AI analysis completes.
- The admin dashboard also provides a manual sync button.

If you need to backfill a specific date locally, run from `backend/`:

```bash
uv run python -c "from datetime import date; from config import settings; from hf_daily import sync_hf_daily_papers; print(sync_hf_daily_papers(settings.hf_daily.api_url, settings.hf_daily.top_n, date(2026, 4, 20)))"
```

### 6. Recommended local dev flow

For a new contributor, this is the shortest path:

```bash
brew services start postgresql@16
createdb paper_online
cp config.yaml.example config.yaml
# edit config.yaml and fill database.url, LLM key, and initial admin
uv run python scripts/apply_migrations.py --seed dev
cd backend && uv run uvicorn app:app --reload --host 127.0.0.1 --port 8000
cd frontend-react && npm run dev
```

## Deployment

### Deployment Modes

There are now two modes:

1. Development mode
   - Run FastAPI and `frontend-react` separately.
   - Use this for local development and UI debugging.

2. Production mode
   - Build `frontend-react` into static assets.
   - FastAPI serves the built React app directly.
   - Only one service needs to run in production.

### Local Production Run

Build the frontend:

```bash
cd frontend-react
npm run build
```

Then start FastAPI:

```bash
cd backend
uv run uvicorn app:app --host 0.0.0.0 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

If `frontend-react/dist` does not exist, FastAPI now returns a clear error telling you to build the frontend first. There is no legacy static frontend fallback anymore.

### Docker / VPS Deployment

This repository includes a production-ready [Dockerfile](./Dockerfile).
It builds `frontend-react`, copies `frontend-react/dist` into the final image, applies PostgreSQL migrations on startup, and launches FastAPI.

For VPS deployment, start Docker Compose from `config.yaml`:

```bash
cp config.yaml.example config.yaml
# edit config.yaml:
# - set server.host to 0.0.0.0
# - set database.url to postgresql://paper:<password>@postgres:5432/paper_online
# - fill LLM keys and initial admin
uv run python scripts/docker_compose.py up --build -d
```

If you only need the application image:

```bash
docker build -t paper-insight .
```

At runtime, the app reads `/app/config.yaml` mounted by Compose.
The Compose setup also persists `/app/data`, so `data/paper_cache/` survives container recreation.

## Project Structure

```
paper_online/
├── backend/
│   ├── app.py          # FastAPI main application
│   ├── auth.py         # Password hashing and session token helpers
│   ├── chat.py         # Chat session management
│   ├── config.py       # config.yaml loader
│   ├── database.py     # PostgreSQL database operations
│   ├── hf_daily.py     # Hugging Face Daily Papers sync logic
│   ├── llm.py          # LLM API wrapper
│   ├── migrations.py   # SQL migration runner
│   ├── prompt.py       # System prompts
│   └── utils.py        # Utility functions
├── db/
│   ├── migrations/     # PostgreSQL schema and search functions
│   └── seeds/          # Minimal local development dataset
├── frontend-react/
│   ├── src/            # React frontend source code
│   ├── dist/           # Built frontend assets
│   └── vite.config.ts  # Vite config
├── scripts/
│   ├── apply_migrations.py # Apply migrations / optional seed
│   ├── docker_compose.py   # Start Docker Compose from config.yaml
│   ├── import_papers.py    # Batch import papers
│   └── migrate_db.sql      # Single-file database migration
├── config.yaml.example   # Runtime config template
└── crawled_data/         # Crawler data storage
    ├── neurips_2025/
    ├── iclr_2026/
    └── icml_2025/
```

## 📦 Batch Import Papers

If you have JSONL data files of conference papers, you can batch import them using:

```bash
uv run python scripts/import_papers.py --conference neurips_2025
uv run python scripts/import_papers.py --conference iclr_2026
uv run python scripts/import_papers.py --conference icml_2025
```

Data files should be placed in the `crawled_data/{conference}/` directory.

## License

Apache 2.0 License
