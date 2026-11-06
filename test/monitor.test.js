import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({entryPoints:['src/monitor.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'node24'});
const {checkProcess} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const number = '99999990020998119999';
function database() {
  const db=new DatabaseSync(':memory:');
  const prepare=sql=>({bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}});
  return {db, binding:{prepare,async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}};
}
const schema=(await readFile(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8')) + '\n' + (await readFile(new URL('../migrations/0002_process_locality.sql',import.meta.url),'utf8'));
function fixture() {
  const {db,binding}=database(); db.exec(schema);
  db.prepare('INSERT INTO processes(id,number,tribunal,instance,created_by) VALUES (?,?,?,?,?)').run('synthetic-process',number,'tjmt','1g','one@example.invalid');
  return {db,env:{DB:binding,CHECK_INTERVAL_MINUTES:'120'}};
}
function source(events) {
  return async url=>new Response(JSON.stringify(String(url).includes('/v2?') ? {itens:[{numeroUnico:number,idInstancia:1,codigoProcessoStr:'999'}],totalRegistros:1} : {numeroUnico:number,segredo:false,eventos:events}),{headers:{'content-type':'application/json'}});
}
const event=(id,description)=>({idProcessoEvento:id,data:`2099-01-0${id}T12:00:00-04:00`,descricao:description,sigilo:false});
test('baseline, new movements, deduplication, leases, per-user reads and cascade deletion', async()=>{
  const {db,env}=fixture(), original=globalThis.fetch;
  try {
    globalThis.fetch=source([event(1,'Primeiro evento sintético')]);
    assert.equal((await checkProcess(env,'synthetic-process')).status,'ok');
    assert.equal(db.prepare('SELECT count(*) n FROM movements').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,0);
    assert.equal((await checkProcess(env,'synthetic-process')).status,'skipped');
    db.exec('UPDATE processes SET next_check_at=0');
    globalThis.fetch=source([event(1,'Primeiro evento sintético'),event(2,'Segundo evento sintético')]);
    const results=await Promise.all([checkProcess(env,'synthetic-process'),checkProcess(env,'synthetic-process')]);
    assert.equal(results.filter(r=>r.status==='ok').length,1);
    assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,1);
    db.exec('UPDATE processes SET next_check_at=0');
    assert.equal((await checkProcess(env,'synthetic-process')).added,0);
    assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,1);
    const notification=db.prepare('SELECT id FROM notifications').get();
    db.prepare('INSERT INTO notification_reads VALUES (?,?)').run(notification.id,'one@example.invalid');
    assert.equal(db.prepare('SELECT count(*) n FROM notification_reads WHERE user_email=?').get('two@example.invalid').n,0);
    db.exec("DELETE FROM processes WHERE id='synthetic-process'");
    for(const table of ['movements','notifications','notification_reads']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  } finally {globalThis.fetch=original;db.close();}
});
test('upstream failures do not create a successful consultation or a baseline',async()=>{
  const {db,env}=fixture(), original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('Unavailable',{status:503});
    assert.equal((await checkProcess(env,'synthetic-process')).status,'error');
    const p=db.prepare('SELECT * FROM processes').get();
    assert.equal(p.checked_at,null);assert.equal(p.initialized,0);assert.match(p.last_error,/503/);
    assert.equal(db.prepare('SELECT count(*) n FROM movements').get().n,0);
  }finally{globalThis.fetch=original;db.close();}
});
test('rejects incomplete pagination instead of replacing a valid history',async()=>{
  const {db,env}=fixture(), original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({itens:[],totalRegistros:1});
    assert.equal((await checkProcess(env,'synthetic-process')).status,'error');
    assert.match(db.prepare('SELECT last_error FROM processes').get().last_error,/incompleta/);
  }finally{globalThis.fetch=original;db.close();}
});
test('legacy TJMT movements with a missing description preserve their type',async()=>{
  const {db,env}=fixture(), original=globalThis.fetch;
  try {
    globalThis.fetch=source([{...event(1,null),tipo:'Movimento legado sintético'}]);
    assert.equal((await checkProcess(env,'synthetic-process')).status,'ok');
    assert.equal(db.prepare('SELECT description FROM movements').get().description,'Movimento legado sintético');
  }finally{globalThis.fetch=original;db.close();}
});

test('consultation fills an empty locality and preserves a manual edit made while fetching', async () => {
  const { db, env } = fixture(), original = globalThis.fetch;
  const originalSource = source([event(1, 'Movimento sintético')]);
  try {
    globalThis.fetch = async url => {
      const response = await originalSource(url);
      const data = await response.json();
      if (Array.isArray(data.eventos)) data.jurisdicao = { nome: 'Comarca automática' };
      return Response.json(data);
    };
    assert.equal((await checkProcess(env, 'synthetic-process')).status, 'ok');
    assert.equal(db.prepare('SELECT locality FROM processes').get().locality, 'Comarca automática');
    db.exec("UPDATE processes SET next_check_at=0,locality='Comarca manual'");
    await checkProcess(env, 'synthetic-process');
    assert.equal(db.prepare('SELECT locality FROM processes').get().locality, 'Comarca manual');
    db.exec("UPDATE processes SET next_check_at=0,locality=''");
    const fetchSource = globalThis.fetch;
    globalThis.fetch = async url => {
      const response = await fetchSource(url);
      if (!String(url).includes('/v2?')) db.exec("UPDATE processes SET locality='Edição durante a consulta'");
      return response;
    };
    await checkProcess(env, 'synthetic-process');
    assert.equal(db.prepare('SELECT locality FROM processes').get().locality, 'Edição durante a consulta');
    assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n, 0);
  } finally { globalThis.fetch = original; db.close(); }
});
