-- US-045: Automated Backups - schema objects

-- Backups catalog (metadata, manifest for integrity verification)
CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('full','incremental')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  location_primary TEXT NOT NULL,
  location_secondary TEXT,
  encryption_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  encryption_algorithm TEXT,
  checksum TEXT,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMP,
  manifest JSONB
);

-- Backup/Restore jobs history
CREATE TABLE IF NOT EXISTS backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL, -- 'full','incremental','restore'
  status TEXT NOT NULL, -- 'pending','running','completed','failed'
  start_time TIMESTAMP NOT NULL DEFAULT NOW(),
  end_time TIMESTAMP,
  affected_objects BIGINT DEFAULT 0
);

-- Restore points for PITR auditability
CREATE TABLE IF NOT EXISTS restore_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_time TIMESTAMP NOT NULL,
  chosen_backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_start_time ON backup_jobs(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_restore_points_target_time ON restore_points(target_time DESC);
