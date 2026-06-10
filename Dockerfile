FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend-react

COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build


FROM python:3.12-slim

WORKDIR /app

# 复制项目文件
COPY ./ /app
COPY --from=frontend-builder /app/frontend-react/dist /app/frontend-react/dist

# 安装依赖
RUN pip install --no-cache-dir fastapi uvicorn openai 'psycopg[binary]' requests sse-starlette tiktoken pyyaml argon2-cffi pypdf

# 在 backend 目录下启动，端口等配置来自 /app/config.yaml
WORKDIR /app/backend
CMD python /app/scripts/apply_migrations.py && python /app/scripts/run_server.py
