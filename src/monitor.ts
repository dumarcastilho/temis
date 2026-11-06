import type { Env, ProcessRow } from './env';
import { queryProcess } from './sources';
import { SourceError } from './mni.js';

const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');

export async function checkProcess(env: Env, id: string, manual = false) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const row = await env.DB.prepare(`UPDATE processes SET lease_token=?, lease_until=? WHERE id=? AND active=1 AND lease_until<? AND (next_check_at<=? OR (?=1 AND COALESCE(checked_at,'') < ?)) RETURNING *`)
    .bind(token, now + 180000, id, now, now, manual ? 1 : 0, new Date(now - 60000).toISOString()).first<ProcessRow>();
  if (!row) return { status: 'skipped', added: 0 };
  const interval = Math.max(15, Math.min(1440, Number(env.CHECK_INTERVAL_MINUTES) || 120)) * 60000;
  let stage = 'query_source';
  try {
    const { movements, locality } = await queryProcess(row, env);
    // Resolve identities before making any writes: an invalid response never creates a partial baseline.
    stage = 'prepare_history';
    const prepared = await Promise.all(movements.map(async m => ({ ...m, id: await hash(row.id + ':' + m.key) })));
    // Lease ownership prevents a slow, superseded run from writing a snapshot.
    const current = await env.DB.prepare('SELECT lease_token FROM processes WHERE id=?').bind(id).first<{ lease_token: string }>();
    if (current?.lease_token !== token) return { status: 'skipped', added: 0 };
    let added = 0;
    // D1 batches are atomic. Each notification is derived from the same insert transaction.
    stage = 'persist_history';
    for (let offset = 0; offset < prepared.length; offset += 30) {
      const statements: D1PreparedStatement[] = [];
      for (const movement of prepared.slice(offset, offset + 30)) {
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO movements(id,process_id,source_id,occurred_at,description) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM processes WHERE id=? AND lease_token=?)`)
          .bind(movement.id, id, movement.id, movement.date, movement.description, id, token));
        if (row.initialized) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,process_id,movement_id) SELECT ?,?,? WHERE changes()=1`).bind(crypto.randomUUID(), id, movement.id));
      }
      const results = await env.DB.batch(statements);
      for (let i = 0; i < results.length; i += row.initialized ? 2 : 1) added += results[i].meta.changes;
    }
    stage = 'complete_check';
    // Check the current stored value so a manual edit made while fetching is preserved.
    await env.DB.prepare(`UPDATE processes SET initialized=1,checked_at=?,last_error=NULL,next_check_at=?,lease_until=0,lease_token=NULL,locality=CASE WHEN trim(locality)='' AND ?<>'' THEN ? ELSE locality END WHERE id=? AND lease_token=?`)
      .bind(new Date().toISOString(), now + interval, locality, locality, id, token).run();
    return { status: 'ok', added: row.initialized ? added : 0 };
  } catch (error) {
    console.error('process_check_failed', { stage, tribunal: row.tribunal, error_name: error instanceof Error ? error.name : 'UnknownError' });
    const message = error instanceof SourceError ? error.message : 'Não foi possível concluir a consulta ao tribunal. Tente novamente mais tarde.';
    await env.DB.prepare(`UPDATE processes SET last_error=?,next_check_at=?,lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?`)
      .bind(message, now + Math.min(interval, 30 * 60000), id, token).run();
    return { status: 'error', message, added: 0 };
  }
}

export async function monitor(env: Env) {
  const rows = await env.DB.prepare('SELECT id FROM processes WHERE active=1 AND next_check_at<=? AND lease_until<? ORDER BY next_check_at LIMIT 10').bind(Date.now(), Date.now()).all<{ id: string }>();
  for (const row of rows.results) await checkProcess(env, row.id);
}
