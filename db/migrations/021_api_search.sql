-- External paper search API (V1).
--
-- New tables only; no changes to existing tables so the shared local
-- database stays compatible with other feature branches.

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the full key. The raw key is never stored.
  key_hash TEXT NOT NULL UNIQUE,
  -- Masked hint such as "pi_ab12...9f8e" for display.
  key_hint TEXT NOT NULL,
  -- active: usable; disabled: blocked (user or admin); revoked: replaced by a newer key.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

-- At most one active key per user (V1 keeps a single usable key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_user_active
ON api_keys(user_id) WHERE status = 'active';

-- Daily API search usage, keyed by Beijing calendar date.
CREATE TABLE IF NOT EXISTS api_usage_daily (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  search_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

-- Per-user quota overrides; NULL columns follow the global defaults from config.yaml.
CREATE TABLE IF NOT EXISTS user_api_quotas (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rpm_limit INTEGER,
  daily_limit INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Minimal-column search for the external API.
--
-- Mirrors the ranking of search_papers_optimized (018) exactly, but:
--   * always searches title + abstract + keywords,
--   * never touches papers.llm_response (too large for API responses),
--   * aggregates authors/keywords with lateral array_agg over the final page
--     only, so the aggregation cost is O(page size) instead of O(matches).
DROP FUNCTION IF EXISTS search_papers_api(TEXT, TEXT, TEXT, INT, INT);
CREATE OR REPLACE FUNCTION search_papers_api(
  search_term TEXT,
  venue_prefix TEXT,
  code_filter TEXT,
  page_limit INT,
  page_offset INT
)
RETURNS TABLE(
  id TEXT,
  title TEXT,
  abstract TEXT,
  venue TEXT,
  code_status TEXT,
  authors TEXT[],
  keywords TEXT[]
) AS $$
DECLARE
  normalized_search_term TEXT;
  normalized_code_filter TEXT;
  query_text tsquery;
BEGIN
  normalized_search_term := NULLIF(BTRIM(search_term), '');
  normalized_code_filter := COALESCE(NULLIF(BTRIM(code_filter), ''), 'all');

  IF normalized_search_term IS NULL THEN
    RETURN QUERY
    WITH page AS (
      SELECT
        p.id,
        p.title,
        p.venue,
        COALESCE(p.sort_order, 2147483647) AS sort_order
      FROM papers p
      WHERE
        (venue_prefix IS NULL OR venue_prefix = '' OR p.venue ILIKE venue_prefix || '%')
        AND (
          normalized_code_filter = 'all'
          OR (normalized_code_filter = 'open_source' AND p.code_status = 'open_source')
          OR (normalized_code_filter = 'not_open_source' AND COALESCE(p.code_status, 'unknown') <> 'open_source')
          OR p.code_status = normalized_code_filter
        )
      ORDER BY
        CASE
          WHEN p.venue ILIKE '%oral%' THEN 1
          WHEN p.venue ILIKE '%spotlight%' THEN 2
          WHEN p.venue ILIKE '%poster%' THEN 3
          ELSE 4
        END ASC,
        COALESCE(p.sort_order, 2147483647) ASC,
        COALESCE(LOWER(p.title), '') ASC,
        p.id ASC
      LIMIT page_limit OFFSET page_offset
    )
    SELECT
      p.id,
      p.title,
      p.abstract,
      p.venue,
      p.code_status,
      COALESCE(aa.authors, ARRAY[]::TEXT[]) AS authors,
      COALESCE(kk.keywords, ARRAY[]::TEXT[]) AS keywords
    FROM page pg
    JOIN papers p ON p.id = pg.id
    LEFT JOIN LATERAL (
      SELECT array_agg(a.author_name ORDER BY a.author_order) AS authors
      FROM authors a
      WHERE a.paper_id = pg.id
    ) aa ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(k.keyword ORDER BY k.id) AS keywords
      FROM keywords k
      WHERE k.paper_id = pg.id
    ) kk ON TRUE
    ORDER BY
      CASE
        WHEN p.venue ILIKE '%oral%' THEN 1
        WHEN p.venue ILIKE '%spotlight%' THEN 2
        WHEN p.venue ILIKE '%poster%' THEN 3
        ELSE 4
      END ASC,
      pg.sort_order ASC,
      COALESCE(LOWER(p.title), '') ASC,
      p.id ASC;

    RETURN;
  END IF;

  query_text := websearch_to_tsquery('english', normalized_search_term);

  RETURN QUERY
  WITH title_matches AS (
    SELECT
      p.id,
      ts_rank(to_tsvector('english', COALESCE(p.title, '')), query_text)::DOUBLE PRECISION * 1.0 AS rank_score
    FROM papers p
    WHERE
      (venue_prefix IS NULL OR venue_prefix = '' OR p.venue ILIKE venue_prefix || '%')
      AND (
        normalized_code_filter = 'all'
        OR (normalized_code_filter = 'open_source' AND p.code_status = 'open_source')
        OR (normalized_code_filter = 'not_open_source' AND COALESCE(p.code_status, 'unknown') <> 'open_source')
        OR p.code_status = normalized_code_filter
      )
      AND to_tsvector('english', COALESCE(p.title, '')) @@ query_text
  ),
  keyword_matches AS (
    SELECT
      k.paper_id AS id,
      MAX(ts_rank(to_tsvector('english', COALESCE(k.keyword, '')), query_text)::DOUBLE PRECISION * 0.55) AS rank_score
    FROM keywords k
    JOIN papers p ON p.id = k.paper_id
    WHERE
      (venue_prefix IS NULL OR venue_prefix = '' OR p.venue ILIKE venue_prefix || '%')
      AND (
        normalized_code_filter = 'all'
        OR (normalized_code_filter = 'open_source' AND p.code_status = 'open_source')
        OR (normalized_code_filter = 'not_open_source' AND COALESCE(p.code_status, 'unknown') <> 'open_source')
        OR p.code_status = normalized_code_filter
      )
      AND to_tsvector('english', COALESCE(k.keyword, '')) @@ query_text
    GROUP BY k.paper_id
  ),
  abstract_matches AS (
    SELECT
      p.id,
      ts_rank(to_tsvector('english', COALESCE(p.abstract, '')), query_text)::DOUBLE PRECISION * 0.35 AS rank_score
    FROM papers p
    WHERE
      (venue_prefix IS NULL OR venue_prefix = '' OR p.venue ILIKE venue_prefix || '%')
      AND (
        normalized_code_filter = 'all'
        OR (normalized_code_filter = 'open_source' AND p.code_status = 'open_source')
        OR (normalized_code_filter = 'not_open_source' AND COALESCE(p.code_status, 'unknown') <> 'open_source')
        OR p.code_status = normalized_code_filter
      )
      AND to_tsvector('english', COALESCE(p.abstract, '')) @@ query_text
  ),
  ranked_papers AS (
    SELECT
      candidates.id,
      SUM(candidates.rank_score) AS rank_score
    FROM (
      SELECT tm.id, tm.rank_score FROM title_matches tm
      UNION ALL
      SELECT km.id, km.rank_score FROM keyword_matches km
      UNION ALL
      SELECT am.id, am.rank_score FROM abstract_matches am
    ) candidates
    GROUP BY candidates.id
  ),
  page AS (
    SELECT
      rp.id,
      rp.rank_score,
      mp.venue,
      mp.title,
      COALESCE(mp.sort_order, 2147483647) AS sort_order
    FROM ranked_papers rp
    JOIN papers mp ON mp.id = rp.id
    ORDER BY
      ROUND(rp.rank_score::NUMERIC, 4) DESC,
      CASE
        WHEN mp.venue ILIKE '%oral%' THEN 1
        WHEN mp.venue ILIKE '%spotlight%' THEN 2
        WHEN mp.venue ILIKE '%poster%' THEN 3
        ELSE 4
      END ASC,
      rp.rank_score DESC,
      COALESCE(mp.sort_order, 2147483647) ASC,
      COALESCE(LOWER(mp.title), '') ASC,
      mp.id ASC
    LIMIT page_limit OFFSET page_offset
  )
  SELECT
    p.id,
    p.title,
    p.abstract,
    p.venue,
    p.code_status,
    COALESCE(aa.authors, ARRAY[]::TEXT[]) AS authors,
    COALESCE(kk.keywords, ARRAY[]::TEXT[]) AS keywords
  FROM page pg
  JOIN papers p ON p.id = pg.id
  LEFT JOIN LATERAL (
    SELECT array_agg(a.author_name ORDER BY a.author_order) AS authors
    FROM authors a
    WHERE a.paper_id = pg.id
  ) aa ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(k.keyword ORDER BY k.id) AS keywords
    FROM keywords k
    WHERE k.paper_id = pg.id
  ) kk ON TRUE
  ORDER BY
    ROUND(pg.rank_score::NUMERIC, 4) DESC,
    CASE
      WHEN p.venue ILIKE '%oral%' THEN 1
      WHEN p.venue ILIKE '%spotlight%' THEN 2
      WHEN p.venue ILIKE '%poster%' THEN 3
      ELSE 4
    END ASC,
    pg.rank_score DESC,
    pg.sort_order ASC,
    COALESCE(LOWER(p.title), '') ASC,
    p.id ASC;
END;
$$ LANGUAGE plpgsql;
