export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  APP_ORIGIN: string;
  CHECK_INTERVAL_MINUTES?: string;
  COURT_CONNECTORS?: string;
  LOCAL_DEV?: string;
}

export interface ProcessRow {
  id: string; number: string; tribunal: string; instance: string; label: string; notes: string;
  active: number; initialized: number; checked_at: string | null;
  source_updated_at: string | null; last_error: string | null;
  lease_token: string | null;
}
