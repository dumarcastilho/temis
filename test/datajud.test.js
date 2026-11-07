import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['src/sources.ts','src/datajud.ts'],bundle:true,write:false,outdir:'out',format:'esm',platform:'node',target:'node24'});
const modules={};for(const f of bundle.outputFiles)modules[f.path.split('/').at(-1)]=await import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'));
const {queryProcess}=modules['sources.js'],{queryDatajud}=modules['datajud.js'];
const n='99999990020998209999', key='syntheticPublicKeyBase64==';
const p={number:n,tribunal:'tjrn',instance:'1g',locality:'Comarca manual'};
const env={DATAJUD_API_KEY:key};
const movement=(code=92,time='2099-01-01T12:00:00Z')=>({codigo:code,nome:code===92?'Publicação':'',dataHora:time,complementosTabelados:[]});
const record=(movements=[movement()])=>({numeroProcesso:n,grau:'G1',movimentos:movements,dataHoraUltimaAtualizacao:'2099-01-02T10:00:00Z','@timestamp':'2099-01-02T11:00:00Z'});
const response=(records=[record()],total=records.length)=>({_shards:{failed:0},timed_out:false,hits:{total:{value:total,relation:'eq'},hits:records.map((r,i)=>({_id:String(i),_source:r}))}});

test('DataJud queries only the selected official tribunal, case and grades with a server-side public key',async()=>{
 const original=fetch;let calls=0;
 globalThis.fetch=async(url,o)=>{calls++;assert.equal(String(url),'https://api-publica.datajud.cnj.jus.br/api_publica_tjrn/_search');assert.equal(o.redirect,'manual');assert.equal(o.headers.Authorization,'APIKey '+key);const q=JSON.parse(o.body);assert.deepEqual(q.query.bool.filter,[{match:{numeroProcesso:n}},{bool:{should:[{match:{grau:'G1'}},{match:{grau:'JE'}}],minimum_should_match:1}}]);return Response.json(response([record([movement(),movement(51)])]));};
 try{const r=await queryDatajud(p,env);assert.equal(calls,1);assert.equal(r.movements[0].description,'Publicação');assert.equal(r.movements[1].description,'Conclusão');assert.equal(r.updatedAt,'2099-01-02T11:00:00.000Z');assert.ok(!JSON.stringify(r).includes(key));}finally{globalThis.fetch=original;}
});
test('DataJud identities survive label corrections, complement object order and duplicate documents',async()=>{
 const original=fetch;let change=false;
 globalThis.fetch=async()=>{const m={...movement(),nome:change?'Nome atualizado':'Nome anterior',complementosTabelados:change?[{valor:'X',descricao:'Detalhe'}]:[{descricao:'Detalhe',valor:'X'}]};return Response.json(response([record([m,m]),record([m])]));};
 try{const a=await queryDatajud(p,env);change=true;const b=await queryDatajud(p,env);assert.equal(a.movements.length,1);assert.equal(a.movements[0].key,b.movements[0].key);assert.match(b.movements[0].description,/Nome atualizado/);}finally{globalThis.fetch=original;}
});
test('DataJud rejects missing cases, partial searches, wrong identity, grade, malformed histories and invalid timestamps',async()=>{
 const original=fetch;
 const bad=[response([],0),{...response(),timed_out:true},{...response(),_shards:{failed:1}},response([{...record(),numeroProcesso:'11111111111111111111'}]),response([{...record(),grau:'G2'}]),response([{...record(),movimentos:null}]),response([record([movement(92,'ontem')])]),response([record([{...movement(),codigo:null}])]),{...response(),hits:{...response().hits,total:{value:1,relation:'gte'}}}];
 try{for(const r of bad){globalThis.fetch=async()=>Response.json(r);await assert.rejects(queryDatajud(p,env));}let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(response([],2));};await assert.rejects(queryDatajud(p,env),/incompleto/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('DataJud does not follow redirects or send keys to another host; transport errors and invalid settings fail safely',async()=>{
 const original=fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://other.example.invalid'}})};await assert.rejects(queryDatajud(p,env),/302/);assert.equal(calls,1);globalThis.fetch=async()=>{throw Error('private transport detail')};await assert.rejects(queryDatajud(p,env),/dentro do prazo/);await assert.rejects(queryDatajud({...p,tribunal:'unknown'},env),/não permitido/);await assert.rejects(queryDatajud(p,{DATAJUD_API_KEY:'invalid key'}),/Chave/);}finally{globalThis.fetch=original;}
});
test('direct consultation remains the priority and DataJud is used only after a direct failure or absent connector',async()=>{
 const original=fetch;const calls=[];
 globalThis.fetch=async(url)=>{calls.push(String(url));if(String(url).includes('pjemni.app.tjpe'))return new Response('Denied',{status:403});return Response.json(response());};
 try{const r=await queryProcess({...p,tribunal:'tjpe'},env);assert.equal(r.source,'datajud');assert.match(r.fallbackReason,/403/);assert.equal(calls.length,2);calls.length=0;const noConnector=await queryProcess(p,env);assert.equal(noConnector.source,'datajud');assert.equal(calls.length,1);calls.length=0;await assert.rejects(queryProcess(p,{...env,DATAJUD_ENABLED:'false'}),/aguarda configuração/);assert.equal(calls.length,0);}finally{globalThis.fetch=original;}
});
test('DataJud can obtain and cache the public CNJ key without persisting it or requiring an environment setting',async()=>{
 const original=fetch;let docs=0;
 globalThis.fetch=async(url,o)=>{if(String(url).includes('datajud-wiki')){docs++;assert.equal(o.redirect,'manual');return new Response(`<p>Authorization: <span>APIKey</span> <code>${key}</code></p>`)}assert.equal(o.headers.Authorization,'APIKey '+key);return Response.json(response());};
 try{await queryDatajud(p,{});await queryDatajud(p,{});assert.equal(docs,1);}finally{globalThis.fetch=original;}
});

test('an explicit non-public response from a direct source does not trigger a DataJud fallback',async()=>{
 const original=fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;if(String(url).includes('/v2?'))return Response.json({itens:[{numeroUnico:n,idInstancia:1,codigoProcessoStr:'999'}],totalRegistros:1});return Response.json({numeroUnico:n,segredo:true,eventos:[]});};
 try{await assert.rejects(queryProcess({...p,tribunal:'tjmt'},env),/não permite consulta pública/);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
