CREATE TABLE process_information (
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('direct','datajud','djen')),
  data_json TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT,
  source_updated_at TEXT,
  last_error TEXT,
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (process_id,provider)
);
