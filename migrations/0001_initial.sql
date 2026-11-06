PRAGMA foreign_keys = ON;

CREATE TABLE processes (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  tribunal TEXT NOT NULL,
  instance TEXT NOT NULL DEFAULT '1g' CHECK (instance IN ('1g','2g')),
  label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  checked_at TEXT,
  source_updated_at TEXT,
  initialized INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE(number, instance)
);
CREATE INDEX processes_due ON processes(active, next_check_at, lease_until);

CREATE TABLE movements (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(process_id, source_id)
);
CREATE INDEX movements_process ON movements(process_id, occurred_at DESC);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  PRIMARY KEY (notification_id, user_email)
);
