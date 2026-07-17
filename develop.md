# develop.md

这个文档记录 Paper Insight 的本地开发、数据准备和部署流程。README 只保留项目必要信息，开发者相关细节统一放在这里。

## 启动指令(开发者)

```bash
brew services start postgresql@16

cd backend
uv run uvicorn app:app --reload --host 127.0.0.1 --port 8000
```


## 当前项目状态

Paper Insight 当前使用：

- 后端：FastAPI
- 前端：React 19 + TypeScript + Vite
- 数据库：PostgreSQL 16
- 数据访问：`psycopg`
- 配置入口：`config.yaml`
- 搜索：PostgreSQL Full Text Search + GIN index
- 论文正文：缓存到 `data/paper_cache/`，不写入主业务表
- 账号：GitHub OAuth 注册，旧邮箱密码账号可继续登录

运行时真相以代码为准；如果 README、历史脚本和代码有冲突，优先看 `backend/app.py`、`backend/config.py`、`backend/database.py` 和 `db/migrations/`。

## 依赖安装

后端：

```bash
uv sync
```

前端：

```bash
cd frontend-react
npm install
```

## 本地 PostgreSQL 16

推荐使用 Homebrew：

```bash
brew install postgresql@16
brew services start postgresql@16
createdb paper_online
```

常用命令：

```bash
brew services start postgresql@16
brew services stop postgresql@16
brew services restart postgresql@16
brew services list | grep postgresql@16
```

如果要清空重来：

```bash
dropdb --if-exists paper_online
createdb paper_online
```

## 配置 `config.yaml`

复制示例配置：

```bash
cp config.yaml.example config.yaml
```

`config.yaml` 已加入 `.gitignore`，不要提交。

本地开发至少确认：

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

本地 GitHub OAuth App 推荐填写：

- Homepage URL：`http://127.0.0.1:8000`
- Authorization callback URL：`http://127.0.0.1:8000/auth/github/callback`

生产 GitHub OAuth App 推荐单独创建：

- Homepage URL：`https://paper-insight.herobase.tech`
- Authorization callback URL：`https://paper-insight.herobase.tech/auth/github/callback`

## 初始化数据库

执行 migration：

```bash
uv run python scripts/apply_migrations.py
```

后端启动时也会自动执行 SQL migration；手动运行脚本主要用于提前准备全新的本地数据库。

如需最小开发数据：

```bash
uv run python scripts/apply_migrations.py --seed dev
```

## 开发模式启动

启动后端：

```bash
cd backend
uv run uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

另开一个终端启动前端：

```bash
cd frontend-react
npm run dev
```

访问：

- 前端：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`

常用页面：

- 首页：`http://127.0.0.1:5173/`
- 全局搜索：`http://127.0.0.1:5173/search?q=agent`
- 会议页：`http://127.0.0.1:5173/conference/iclr_2026`
- Hugging Face Daily Papers：`http://127.0.0.1:5173/hf-daily`
- 登录 / 注册：`http://127.0.0.1:5173/login`、`http://127.0.0.1:5173/register`
- 我的论文：`http://127.0.0.1:5173/me`
- 管理员后台：`http://127.0.0.1:5173/admin`

停止服务时，在两个终端分别按 `Ctrl + C`。

## 本地开发数据

### 方式 A：最小 seed

适合快速启动页面、联调接口，不需要完整线上数据。

```bash
uv run python scripts/apply_migrations.py --seed dev
```

### 方式 B：从 `crawled_data/` 导入

适合重建或补充某个会议的数据。

先确保已经初始化数据库：

```bash
uv run python scripts/apply_migrations.py
```

然后按会议导入：

```bash
uv run python scripts/import_papers.py --conference neurips_2025
uv run python scripts/import_papers.py --conference iclr_2026
uv run python scripts/import_papers.py --conference icml_2025
uv run python scripts/build_chi_2026_jsonl.py
uv run python scripts/import_papers.py --conference chi_2026
uv run python scripts/build_cvpr_2026_jsonl.py
uv run python scripts/import_papers.py --conference cvpr_2026
```

说明：

- 数据源目录固定为 `crawled_data/{conference}/`
- CHI 2026 的元数据源是 DBLP + OpenAlex，先用 `scripts/build_chi_2026_jsonl.py` 生成 `crawled_data/chi_2026/main_papers.jsonl`
- CHI 2026 默认只保留 OpenAlex 提供的非 ACM PDF 论文；ACM DL PDF 在服务器侧常被访问验证拦截，只有维护者明确需要全量元数据时才使用 `--include-acm-only`
- CVPR 2026 的元数据源是 CVF Open Access，先用 `scripts/build_cvpr_2026_jsonl.py` 生成 `crawled_data/cvpr_2026/main_papers.jsonl`；默认排序写入 `sort_order`，会议页按 CVF 官方 `day=all` 顺序展示
- 导入是按论文覆盖式刷新
- `papers` 会 upsert
- 对应论文的 `authors` / `keywords` 会先删后插
- `llm_response` 不会在导入阶段生成，后续由用户访问或后台分析补全

## 论文正文磁盘缓存

Jina Reader 解析出来的论文正文不会写入 PostgreSQL，而是缓存到：

```text
data/paper_cache/
```

当前行为：

- 第一次分析论文时，如果缓存不存在，会调用 Jina Reader 并写入缓存
- 第一次初始化 chat 上下文时，如果缓存不存在，也会调用 Jina Reader
- 命中缓存后，analysis / chat / 后台分析都会直接复用本地文本

如果想强制重新抓取正文：

```bash
rm -rf data/paper_cache
```

## Hugging Face Daily Papers

默认配置会启用每日同步：

```yaml
hf_daily:
  enabled: true
  api_url: https://huggingface.co/api/daily_papers
  fetch_time: "22:00"
  timezone: Asia/Shanghai
  top_n: 5
```

当前行为：

- 定时任务运行在 FastAPI 进程内
- 每个配置日期抓取一次 Hugging Face Daily Papers API
- 点赞数最高的论文会写入 `papers`，来源元数据写入 `hf_daily_papers`
- 新论文在 AI 分析完成前保持 `llm_response IS NULL`
- 管理员后台提供手动同步按钮

## 推荐本地开发顺序

```bash
brew services start postgresql@16
createdb paper_online
cp config.yaml.example config.yaml
# 编辑 config.yaml，填入 database.url、LLM key、GitHub OAuth 和初始管理员
uv run python scripts/apply_migrations.py --seed dev
(cd backend && uv run uvicorn app:app --reload --host 127.0.0.1 --port 8000)
(cd frontend-react && npm run dev)
```

## 本地模拟生产运行

先构建前端：

```bash
cd frontend-react
npm run build
```

再启动 FastAPI：

```bash
cd backend
uv run uvicorn app:app --host 0.0.0.0 --port 8000
```

访问：

```text
http://127.0.0.1:8000
```

如果 `frontend-react/dist` 不存在，FastAPI 会返回明确错误，提示先构建前端。

## Docker / VPS 部署

仓库包含可直接使用的 [Dockerfile](./Dockerfile)。它会：

- 构建 `frontend-react`
- 将 `frontend-react/dist` 复制进最终镜像
- 在启动前自动执行 PostgreSQL migration
- 启动 FastAPI

推荐在 VPS 上通过 `config.yaml` 启动 Docker Compose：

```bash
cp config.yaml.example config.yaml
# 编辑 config.yaml：
# - server.host 改为 0.0.0.0
# - database.url 改为 postgresql://paper:<password>@postgres:5432/paper_online
# - 填入 LLM key、GitHub OAuth 和初始管理员
uv run python scripts/docker_compose.py up --build -d
```

如果只想构建单个应用镜像：

```bash
docker build -t paper-insight .
```

容器运行时读取挂载进去的 `/app/config.yaml`。当前 Compose 会把 `/app/data` 挂到命名 volume，用来持久化 `data/paper_cache/`。

## 生产更新

当前生产环境使用：

- 域名：`paper-insight.herobase.tech`
- 部署目录：`/opt/paper_online`
- 更新脚本：`/opt/paper_online/deploy.sh`
- Caddy 反代：`127.0.0.1:8000`

日常更新路径：

```bash
ssh root@165.22.4.203 /opt/paper_online/deploy.sh
```

部署后验证：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://paper-insight.herobase.tech/
curl -sS "https://paper-insight.herobase.tech/conference/iclr_2026/papers?limit=1"
```

端口策略必须保持：

- Caddy 对外监听 `80/443`
- Docker app 只绑定 `127.0.0.1:8000->8000`
- Docker Postgres 只绑定 `127.0.0.1:5432->5432`

不要把 `8000` 或 `5432` 暴露到公网。

## 项目结构

```text
paper_online/
├── backend/
│   ├── app.py              # FastAPI 主应用
│   ├── auth.py             # 密码哈希与 session token 工具
│   ├── chat.py             # 聊天会话管理
│   ├── config.py           # config.yaml 读取逻辑
│   ├── database.py         # PostgreSQL 数据库操作
│   ├── github_oauth.py     # GitHub OAuth 逻辑
│   ├── hf_daily.py         # Hugging Face Daily Papers 同步逻辑
│   ├── llm.py              # LLM 调用封装
│   ├── migrations.py       # SQL migration 执行器
│   ├── prompt.py           # 系统提示词
│   └── utils.py            # 工具函数
├── db/
│   ├── migrations/         # PostgreSQL schema、索引和搜索函数
│   └── seeds/              # 本地开发小样本数据
├── frontend-react/
│   ├── src/                # React 前端源码
│   ├── dist/               # 前端构建产物
│   └── vite.config.ts      # Vite 配置
├── scripts/
│   ├── apply_migrations.py # 执行 migration / seed
│   ├── docker_compose.py   # 根据 config.yaml 启动 Docker Compose
│   └── import_papers.py    # 批量导入论文
├── config.yaml.example     # 运行时配置模板
└── crawled_data/           # 爬虫数据存储，本仓库不提交
```

## 常用检查

```bash
uv run pytest
cd frontend-react && npm run build
git diff --check
```
