-- US-046: Disaster Recovery - metadata tables

CREATE TABLE IF NOT EXISTS dr_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'failover','failback','test','replication'
  details JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dr_replication_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL, -- 'sync' | 'async'
  lag_ms BIGINT NOT NULL DEFAULT 0,
  last_replicated_at TIMESTAMP,
  pending_ops INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dr_events_created_at ON dr_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_replication_status_updated_at ON dr_replication_status(updated_at DESC);
