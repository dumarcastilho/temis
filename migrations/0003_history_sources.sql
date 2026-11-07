ALTER TABLE processes ADD COLUMN last_source TEXT NOT NULL DEFAULT 'direct' CHECK (last_source IN ('direct','datajud'));
ALTER TABLE processes ADD COLUMN fallback_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN source TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct','datajud'));
CREATE INDEX movements_source_date ON movements(process_id,source,occurred_at DESC);
