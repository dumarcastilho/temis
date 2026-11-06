import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24' });
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const migrationDir = new URL('../migrations/', import.meta.url);
const migrationNames = (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort();
const migrations = await Promise.all(migrationNames.map(name => readFile(new URL(name, migrationDir), 'utf8')));

function binding(db) {
  return { prepare(sql) { return { bind(...values) { return {
    async first() { return db.prepare(sql).get(...values) || null; },
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async run() { const result = db.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
}
async function request(env, path, method = 'GET', body) {
  return worker.fetch(new Request('http://localhost' + path, { method, headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}

test('locality migration preserves existing processes, histories, notifications and read markers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migrations[0]);
    db.exec(`INSERT INTO processes(id,number,tribunal,created_by,label,notes) VALUES ('old','99999990020998209999','tjrn','user@example.invalid','Identificação sintética','Observação sintética');
      INSERT INTO movements(id,process_id,source_id,occurred_at,description) VALUES ('move','old','source','2099-01-01T12:00:00Z','Movimento sintético');
      INSERT INTO notifications(id,process_id,movement_id) VALUES ('notification','old','move');
      INSERT INTO notification_reads VALUES ('notification','user@example.invalid');`);
    for (const migration of migrations.slice(1)) db.exec(migration);
    const row = db.prepare('SELECT locality,label,notes FROM processes WHERE id=?').get('old');
    assert.equal(row.locality, ''); assert.equal(row.label, 'Identificação sintética'); assert.equal(row.notes, 'Observação sintética');
    for (const table of ['movements', 'notifications', 'notification_reads']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('process API persists locality, validates it and preserves it during unrelated edits', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const migration of migrations) db.exec(migration);
    const env = { DB: binding(db), LOCAL_DEV: 'true' };
    const created = await request(env, '/api/processes', 'POST', { number: '99999992420998099999', locality: '  Comarca sintética  ', label: 'Exemplo' });
    assert.equal(created.status, 201); const { id } = await created.json();
    let listed = await (await request(env, '/api/processes')).json();
    assert.equal(listed[0].locality, 'Comarca sintética');
    assert.equal((await request(env, '/api/processes/' + id, 'PATCH', { locality: 'Nova comarca' })).status, 200);
    assert.equal((await request(env, '/api/processes/' + id, 'PATCH', { active: false })).status, 200);
    listed = await (await request(env, '/api/processes')).json();
    assert.equal(listed[0].locality, 'Nova comarca'); assert.equal(listed[0].active, 0);
    for (const invalid of [null, 12, 'x'.repeat(121)]) assert.equal((await request(env, '/api/processes/' + id, 'PATCH', { locality: invalid })).status, 400);
    assert.equal((await request(env, '/api/processes/' + id, 'PATCH', { locality: '' })).status, 200);
    listed = await (await request(env, '/api/processes')).json(); assert.equal(listed[0].locality, '');
  } finally { db.close(); }
});
