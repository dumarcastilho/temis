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

test('court availability enables new first-instance connectors without enabling unvalidated second-instance services', async () => {
  const response = await request({ LOCAL_DEV: 'true' }, '/api/session');
  assert.equal(response.status, 200);
  const { courts } = await response.json();
  assert.equal(courts.length, 57);
  assert.equal(courts.filter(c => c.branch === 'state').length, 27);
  assert.equal(courts.filter(c => c.branch === 'federal').length, 6);
  assert.equal(courts.filter(c => c.branch === 'labor').length, 24);
  const configured = (court, instance) => courts.find(c => c.id === court).instances.find(i => i.instance === instance).directConfigured;
  for (const court of ['tjgo', 'tjba', 'tjpe']) {
    assert.equal(configured(court, '1g'), true);
    assert.equal(configured(court, '2g'), false);
  }
  assert.equal(configured('tjrn', '1g'), false);
  for (const court of ['tjpi', 'tjes', 'tjam']) {
    assert.equal(configured(court, '1g'), false);
    assert.equal(courts.find(c => c.id === court).instances[0].requiresCredentials, true);
  }
  for (const court of courts.filter(c => c.branch !== 'state')) assert.equal(configured(court.id, '1g'), false);
});

test('all national catalog courts accept valid synthetic CNJ registration while excluded branches remain unavailable', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const migration of migrations) db.exec(migration);
    const env = { DB: binding(db), LOCAL_DEV: 'true' };
    const { courts } = await (await request(env, '/api/session')).json();
    for (const court of courts) {
      const suffix = `2099${court.cnjBranch}${court.cnjCode}9999`;
      const base = '9999999' + suffix + '00';
      let mod = 0; for (const digit of base) mod = (mod * 10 + Number(digit)) % 97;
      const number = '9999999' + String(98 - mod).padStart(2, '0') + suffix;
      const result = await request(env, '/api/processes', 'POST', { number, instance: '1g' });
      assert.equal(result.status, 201, court.id);
    }
    const rows = await (await request(env, '/api/processes')).json();
    assert.equal(rows.length, 57); assert.equal(new Set(rows.map(p => p.tribunal)).size, 57);
    assert.ok(rows.every(p => p.instance === '1g' && !p.initialized && !p.checked_at));
  } finally { db.close(); }
});

test('session indicates configured regional connectors without returning service credentials or endpoints', async () => {
  const env = { LOCAL_DEV:'true', DATAJUD_API_KEY:'syntheticPublicKeyBase64==', COURT_CONNECTORS:JSON.stringify({'trt6:1g':{username:'synthetic-user',password:'synthetic-secret'}}) };
  const response = await request(env, '/api/session');
  const result = await response.json();
  assert.equal(result.courts.find(c=>c.id==='trt6').instances[0].configured, true);
  assert.equal(result.courts.find(c=>c.id==='trt15').instances[0].directConfigured, false);
  assert.equal(result.courts.find(c=>c.id==='trt15').instances[0].datajudAvailable, true);
  assert.ok(!JSON.stringify(result).includes('synthetic-user'));
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
  assert.ok(!JSON.stringify(result).includes(env.DATAJUD_API_KEY));
  assert.ok(!JSON.stringify(result).includes('mni222/intercomunicacao'));
});

test('source migration preserves old history and the API shows the active source while allowing access to archived source histories',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const migration of migrations)db.exec(migration);
  const env={DB:binding(db),LOCAL_DEV:'true'};
  const created=await request(env,'/api/processes','POST',{number:'99999992420998099999'});const {id}=await created.json();
  db.prepare('INSERT INTO movements(id,process_id,source_id,occurred_at,description,source) VALUES (?,?,?,?,?,?)').run('old-direct',id,'old-direct','2099-01-03T12:00:00Z','Direto sintético','direct');
  db.prepare('INSERT INTO movements(id,process_id,source_id,occurred_at,description,source) VALUES (?,?,?,?,?,?)').run('datajud',id,'datajud','2099-01-01T12:00:00Z','DataJud sintético','datajud');
  db.prepare("UPDATE processes SET last_source='datajud',initialized=1,checked_at='2099-01-04T12:00:00Z' WHERE id=?").run(id);
  const list=await(await request(env,'/api/processes')).json();assert.equal(list[0].latest_movement,'DataJud sintético');
  const active=await(await request(env,`/api/processes/${id}/movements`)).json();assert.equal(active.items.length,1);assert.equal(active.source,'datajud');
  const archived=await(await request(env,`/api/processes/${id}/movements?source=direct`)).json();assert.equal(archived.items[0].description,'Direto sintético');
  assert.equal((await request(env,`/api/processes/${id}/movements?source=unknown`)).status,400);
  const disabled=await(await request({...env,DATAJUD_ENABLED:'false'},'/api/session')).json();
  assert.equal(disabled.courts.find(c=>c.id==='trt6').instances[0].configured,false);
 }finally{db.close();}
});

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
