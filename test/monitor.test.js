import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const bundle = await build({entryPoints:['src/monitor.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'node24'});
const {checkProcess} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const number = '99999990020998119999';
function database() {
  const db=new DatabaseSync(':memory:');
  const prepare=sql=>({bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}});
  return {db, binding:{prepare,async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}};
}
const schema = (await Promise.all(['0001_initial.sql','0002_process_locality.sql','0003_history_sources.sql'].map(name => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')))).join('\n');
function fixture() {
  const {db,binding}=database(); db.exec(schema);
  db.prepare('INSERT INTO processes(id,number,tribunal,instance,created_by) VALUES (?,?,?,?,?)').run('synthetic-process',number,'tjmt','1g','one@example.invalid');
  return {db,env:{DB:binding,CHECK_INTERVAL_MINUTES:'120',DATAJUD_ENABLED:'false'}};
}
function source(events) {
  return async url=>new Response(JSON.stringify(String(url).includes('/v2?') ? {itens:[{numeroUnico:number,idInstancia:1,codigoProcessoStr:'999'}],totalRegistros:1} : {numeroUnico:number,segredo:false,eventos:events}),{headers:{'content-type':'application/json'}});
}
const event=(id,description)=>({idProcessoEvento:id,data:`2099-01-0${id}T12:00:00-04:00`,descricao:description,sigilo:false});

test('TPU label enrichment updates an existing MNI movement without duplicate rows, alerts or changed read markers',async()=>{
 const {db,env}=fixture(),original=fetch;
 try{
  db.exec("UPDATE processes SET tribunal='tjpe',initialized=1");
  const key=JSON.stringify(['synthetic','2099-01-01T12:00:00-03:00','92','Movimento 92']);
  const id=createHash('sha256').update('synthetic-process:'+key).digest('hex');
  db.prepare('INSERT INTO movements(id,process_id,source_id,occurred_at,description) VALUES (?,?,?,?,?)').run(id,'synthetic-process',id,'2099-01-01T15:00:00.000Z','Movimento 92');
  db.prepare('INSERT INTO notifications(id,process_id,movement_id) VALUES (?,?,?)').run('existing-alert','synthetic-process',id);
  db.prepare('INSERT INTO notification_reads VALUES (?,?)').run('existing-alert','one@example.invalid');
  globalThis.fetch=async()=>new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><consultarProcessoResposta><sucesso>true</sucesso><processo><dadosBasicos numero="${number}"/><movimento dataHora="20990101120000" identificadorMovimento="synthetic"><movimentoNacional codigoNacional="92"/></movimento></processo></consultarProcessoResposta></s:Body></s:Envelope>`);
  const result=await checkProcess(env,'synthetic-process');assert.equal(result.status,'ok');assert.equal(result.added,0);
  assert.equal(db.prepare('SELECT description FROM movements WHERE id=?').get(id).description,'Publicação');
  for(const table of ['movements','notifications','notification_reads'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);
 }finally{globalThis.fetch=original;db.close();}
});

test('switching to DataJud and back creates source baselines, preserves archives and notifies only subsequent new movements',async()=>{
 const {db,env}=fixture(),original=fetch;
 const enabled={...env,DATAJUD_ENABLED:'true',DATAJUD_API_KEY:'syntheticPublicKeyBase64=='};
 try{
  globalThis.fetch=source([event(1,'Direto sintético')]);await checkProcess(enabled,'synthetic-process');
  let next=false;
  globalThis.fetch=async url=>{
   if(!String(url).includes('api-publica.datajud'))return new Response('Unavailable',{status:503});
   const moves=[{codigo:92,nome:'Publicação',dataHora:'2099-01-01T16:00:00Z'},...(next?[{codigo:51,nome:'Conclusão',dataHora:'2099-01-02T16:00:00Z'}]:[])];
   return Response.json({timed_out:false,_shards:{failed:0},hits:{total:{value:1,relation:'eq'},hits:[{_id:'synthetic',_source:{numeroProcesso:number,grau:'G1',movimentos:moves,'@timestamp':'2099-01-03T12:00:00Z'}}]}});
  };
  db.exec('UPDATE processes SET next_check_at=0');let r=await checkProcess(enabled,'synthetic-process');assert.equal(r.source,'datajud');assert.equal(r.added,0);assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM movements WHERE source=?').get('direct').n,1);
  assert.equal(db.prepare('SELECT last_source FROM processes').get().last_source,'datajud');
  db.exec('UPDATE processes SET next_check_at=0');next=true;r=await checkProcess(enabled,'synthetic-process');assert.equal(r.added,1);assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,1);
  db.exec('UPDATE processes SET next_check_at=0');globalThis.fetch=source([event(1,'Direto sintético'),event(2,'Direto novo sintético')]);r=await checkProcess(enabled,'synthetic-process');assert.equal(r.source,'direct');assert.equal(r.added,0);assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM movements WHERE source=?').get('datajud').n,2);
 }finally{globalThis.fetch=original;db.close();}
});
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
