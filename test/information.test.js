import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir,readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const b=await build({entryPoints:['src/information.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {refreshInformation,getInformation,storeCaseInformation}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const migrations=await readdir(new URL('../migrations/',import.meta.url));
const schema=(await Promise.all(migrations.filter(s=>s.endsWith('.sql')).sort().map(s=>readFile(new URL('../migrations/'+s,import.meta.url),'utf8')))).join('\n');
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  const process = {id:'synthetic',number:'99999990020998179999',tribunal:'tjpe',instance:'1g'};
  db.prepare('INSERT INTO processes(id,number,tribunal,created_by) VALUES (?,?,?,?)').run(process.id,process.number,process.tribunal,'user@example.invalid');
  const DB = {
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() { return db.prepare(sql).get(...args) || null; },
          async all() { return {results:db.prepare(sql).all(...args)}; },
          async run() { return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}; },
        };
      } };
    },
  };
  return {db,process,env:{DB,DATAJUD_API_KEY:'syntheticPublicKeyBase64=='}};
}
const answer=p=>({timed_out:false,_shards:{failed:0},hits:{total:{value:1,relation:'eq'},hits:[{_id:'synthetic',_source:{numeroProcesso:p.number,grau:'G1',classe:{codigo:1,nome:'Classe sintética'},assuntos:[{codigo:1,nome:'Assunto sintético'}],orgaoJulgador:{codigo:1,nome:'Órgão sintético'},dataAjuizamento:'2099-01-01T12:00:00Z','@timestamp':'2099-01-02T12:00:00Z'}}]}});
test('information fetch is cached, preserves old data on failure, respects cooldowns and never creates movements or alerts',async()=>{
 const{db,process,env}=fixture(),old=fetch;let calls=0;
 globalThis.fetch=async(_url,o)=>{calls++;assert.ok(!JSON.parse(o.body)._source.includes('movimentos'));return Response.json(answer(process));};
 try{
  assert.equal((await refreshInformation(env,process,'datajud')).status,'ok');assert.equal((await refreshInformation(env,process,'datajud')).status,'cached');assert.equal(calls,1);
  let rows=await getInformation(env,process.id);assert.equal(rows[0].data.caseClass.name,'Classe sintética');assert.ok(!JSON.stringify(rows).includes(env.DATAJUD_API_KEY));assert.ok(!JSON.stringify(rows).includes('lease_token'));
  db.exec('UPDATE process_information SET last_attempt_at=0,next_check_at=0');globalThis.fetch=async()=>new Response('Unavailable',{status:503});assert.equal((await refreshInformation(env,process,'datajud',true)).status,'error');
  rows=await getInformation(env,process.id);assert.equal(rows[0].data.caseClass.name,'Classe sintética');assert.match(rows[0].error,/503/);assert.equal((await refreshInformation(env,process,'datajud',true)).status,'cached');
  for(const table of ['movements','notifications'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal(db.prepare('SELECT initialized FROM processes').get().initialized,0);
  db.prepare('DELETE FROM processes WHERE id=?').run(process.id);assert.equal(db.prepare('SELECT count(*) n FROM process_information').get().n,0);
 }finally{globalThis.fetch=old;db.close();}
});
test('native information requires the current process lease and does not clear a concurrent information-source lease',async()=>{
 const{db,process,env}=fixture();
 try{db.exec("UPDATE processes SET lease_token='owner'");await storeCaseInformation(env,process.id,'direct',{system:'Sintético'},null,'stale');assert.equal((await getInformation(env,process.id)).length,0);await storeCaseInformation(env,process.id,'direct',{system:'Sintético'},null,'owner');assert.equal((await getInformation(env,process.id))[0].data.system,'Sintético');
 await storeCaseInformation(env,process.id,'datajud',{system:'Primeiro'},'2099-01-01T00:00:00Z','owner');
 db.prepare("UPDATE process_information SET lease_token='information-owner',lease_until=? WHERE provider='datajud'").run(Date.now()+60000);
 await storeCaseInformation(env,process.id,'datajud',{system:'Atualizado'},'2099-01-02T00:00:00Z','owner');
 assert.equal(db.prepare("SELECT lease_token FROM process_information WHERE provider='datajud'").get().lease_token,'information-owner');}finally{db.close();}
});
