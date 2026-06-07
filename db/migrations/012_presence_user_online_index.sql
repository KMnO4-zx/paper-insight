CREATE INDEX IF NOT EXISTS idx_presence_heartbeats_user_last_seen
ON presence_heartbeats(user_id, last_seen_at DESC)
WHERE user_id IS NOT NULL;
