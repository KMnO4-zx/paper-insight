# 数据库与迁移脚本

当前仓库已经从 **Supabase SDK + 托管数据库** 迁移为 **标准 PostgreSQL 16**。
普通贡献者只需要关注：

- `scripts/apply_migrations.py`
- `scripts/import_papers.py`
- `scripts/migrate_db.sql`

`export_supabase.sh` / `restore_supabase_dump.sh` 是**维护者内部迁移脚本**，不属于常规贡献流程。

## 目录说明

- `scripts/apply_migrations.py`：按顺序执行 `db/migrations/*.sql`
- `scripts/import_papers.py`：将 `crawled_data/{conference}` 下的 JSONL 导入 PostgreSQL
- `scripts/download_icml_2026_openreview.py`：登录 OpenReview 后低速下载 ICML 2026 metadata JSONL，不导入数据库
- `scripts/build_chi_2026_jsonl.py`：从 DBLP + OpenAlex 生成 CHI 2026 的导入 JSONL
- `scripts/build_cvpr_2026_jsonl.py`：从 CVF Open Access 生成 CVPR 2026 的导入 JSONL
- `scripts/export_supabase.sh`：使用 `pg_dump` 导出 Supabase schema 和 data
- `scripts/restore_supabase_dump.sh`：将导出的 `supabase_data.dump` 恢复到本地 PostgreSQL
- `scripts/migrate_db.sql`：单文件版完整 migration，方便手动执行

## 本地初始化数据库

先复制并编辑根目录配置：

```bash
cp config.yaml.example config.yaml
```

确认 `config.yaml` 中的 `database.url` 指向本地 PostgreSQL。

执行 migration：

```bash
uv run python scripts/apply_migrations.py
```

如果要导入最小开发数据：

```bash
uv run python scripts/apply_migrations.py --seed dev
```

## 导入真实会议数据

```bash
uv run python scripts/import_papers.py --conference neurips_2025
uv run python scripts/import_papers.py --conference iclr_2026
uv run python scripts/import_papers.py --conference icml_2025
uv run python scripts/save_openreview_credentials.py
uv run python scripts/download_icml_2026_openreview.py
uv run python scripts/build_chi_2026_jsonl.py
uv run python scripts/import_papers.py --conference chi_2026
uv run python scripts/build_cvpr_2026_jsonl.py
uv run python scripts/import_papers.py --conference cvpr_2026
```

ICML 2026 的下载脚本只抓取 OpenReview note metadata，默认单线程、每页 25 条、每次请求 sleep 3 到 5 秒，并支持断点续跑。下载完成后先检查
`crawled_data/icml_2026/download_report.json`，确认 `spotlight_papers.jsonl` 和 `regular_papers.jsonl` 都没有字段缺失，再考虑执行数据库导入。

CHI 2026 的生成脚本默认只保留 OpenAlex 提供的非 ACM PDF 论文，避免把服务器无法读取的 ACM DL PDF 链接导入线上库。维护者如需全量元数据，可显式加 `--include-acm-only`。

CVPR 2026 的生成脚本使用 CVF Open Access 的 `day=all` 页面，导入时写入 `sort_order`，会议页默认按 CVF 官方列表顺序展示。

## 维护者：从 Supabase 导出现有数据

需要先安装 PostgreSQL 客户端工具（`pg_dump` 主版本应尽量与 Supabase 数据库一致，例如服务端是 PostgreSQL 17 时使用 `pg_dump` 17），并配置 **Session pooler** 连接串：

```bash
SUPABASE_DATABASE_URL=postgresql://postgres.<project-ref>:password@aws-0-<region>.pooler.supabase.com:5432/postgres
```

然后执行：

```bash
./scripts/export_supabase.sh
```

如果系统里有多个 `pg_dump` 版本，可以显式指定：

```bash
PG_DUMP_BIN=/opt/homebrew/opt/postgresql@17/bin/pg_dump ./scripts/export_supabase.sh
```

导出产物会写到：

- `db/dumps/supabase_schema.sql`
- `db/dumps/supabase_data.dump`

## 维护者：将导出的数据恢复到本地 PostgreSQL

先执行仓库 migration，再恢复数据：

```bash
uv run python scripts/apply_migrations.py
./scripts/restore_supabase_dump.sh
```

如果本机装了多个客户端版本，也可以显式指定：

```bash
PG_RESTORE_BIN=/opt/homebrew/opt/postgresql@17/bin/pg_restore \
PSQL_BIN=/opt/homebrew/opt/postgresql@16/bin/psql \
./scripts/restore_supabase_dump.sh
```
