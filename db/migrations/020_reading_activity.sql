ALTER TABLE paper_marks
  ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;

-- Older rows can only be recovered when their current viewed timestamp still
-- exists.  Rows that were unmarked before this migration have no trustworthy
-- historical timestamp to backfill.
UPDATE paper_marks
SET first_viewed_at = viewed_at
WHERE first_viewed_at IS NULL
  AND viewed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paper_marks_user_first_viewed_at
ON paper_marks(user_id, first_viewed_at DESC)
WHERE first_viewed_at IS NOT NULL;

-- first_viewed_at is an event timestamp, not current mark state.  Keep it
-- immutable even if a future write path accidentally attempts to replace or
-- clear it after it has been recorded.
CREATE OR REPLACE FUNCTION preserve_paper_mark_first_viewed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.first_viewed_at IS NOT NULL THEN
    NEW.first_viewed_at := OLD.first_viewed_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paper_marks_preserve_first_viewed_at ON paper_marks;

CREATE TRIGGER trg_paper_marks_preserve_first_viewed_at
BEFORE UPDATE OF first_viewed_at ON paper_marks
FOR EACH ROW
EXECUTE FUNCTION preserve_paper_mark_first_viewed_at();
