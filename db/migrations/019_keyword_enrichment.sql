ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS keywords_source TEXT,
  ADD COLUMN IF NOT EXISTS keywords_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS keywords_meta JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_papers_keywords_checked_at
ON papers(keywords_checked_at);

CREATE INDEX IF NOT EXISTS idx_keywords_paper_keyword_lower
ON keywords(paper_id, LOWER(keyword));
