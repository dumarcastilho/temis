import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const b=await build({entryPoints:['src/djen.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {queryDjen}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const p={number:'99999990020998179999',tribunal:'tjpe',instance:'1g'};
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const item=(id=1)=>({id,data_disponibilizacao:day,siglaTribunal:'TJPE',numero_processo:p.number,ativo:true,tipoComunicacao:'Intimação',nomeOrgao:'Órgão sintético',texto:'<p>Publicação <strong>sintética</strong> &amp; pública.</p><script>ignored()</script>',link:'https://pje.cloud.tjpe.jus.br/1g/documento?x=synthetic',destinatarios:[{nome:'Destinatário sintético',cpf_cnpj:'Não armazenar'}],destinatarioadvogados:[{advogado:{nome:'Advogado sintético'}}]});
const body=(items=[item()],count=items.length)=>({status:'success',count,items});
test('DJEN requests the exact official court and CNJ, keeps publications separate and strips HTML without keeping personal document identifiers',async()=>{
 const old=fetch;globalThis.fetch=async(url,o)=>{const u=new URL(url);assert.equal(u.origin,'https://comunicaapi.pje.jus.br');assert.equal(u.searchParams.get('numeroProcesso'),p.number);assert.equal(u.searchParams.get('siglaTribunal'),'TJPE');assert.equal(u.searchParams.get('itensPorPagina'),'100');assert.equal(o.redirect,'manual');assert.equal(o.headers.Authorization,undefined);return Response.json(body());};
 try{const r=await queryDjen(p);assert.equal(r.publications.length,1);assert.equal(r.publications[0].text,'Publicação sintética & pública.');assert.ok(!JSON.stringify(r).includes('Não armazenar'));assert.equal(r.limited,false);}finally{globalThis.fetch=old;}
});
test('DJEN refuses unrelated cases, wrong courts, duplicate pages and malformed dates, preserves cancellation and blocks unsafe links',async()=>{
 const old=fetch;
 try{
  for(const row of [{...item(),numero_processo:'11111111111111111111'},{...item(),siglaTribunal:'TJGO'},{...item(),data_disponibilizacao:'invalid'},{...item(),ativo:'true'}]){globalThis.fetch=async()=>Response.json(body([row]));await assert.rejects(queryDjen(p));}
  globalThis.fetch=async()=>Response.json(body([{...item(),ativo:false,link:'javascript:alert(1)'}]));const r=await queryDjen(p);assert.equal(r.publications[0].active,false);assert.equal(r.publications[0].link,'');
  globalThis.fetch=async()=>Response.json(body([item(),item()]));await assert.rejects(queryDjen(p),/não corresponde/);
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://other.example.invalid'}});await assert.rejects(queryDjen(p),/302/);
 }finally{globalThis.fetch=old;}
});
test('DJEN pagination limits and long text are explicitly indicated instead of claiming a complete history',async()=>{
 const old=fetch;let calls=0;
 globalThis.fetch=async()=>{const start=calls++*100;return Response.json(body(Array.from({length:100},(_,i)=>({...item(start+i+1),texto:'x'.repeat(13000)})),300));};
 try{const r=await queryDjen(p);assert.equal(calls,2);assert.equal(r.total,300);assert.equal(r.limited,true);assert.ok(r.publications.length<=50);assert.ok(r.publications[0].truncated);assert.ok(new TextEncoder().encode(JSON.stringify(r)).byteLength<600000);}finally{globalThis.fetch=old;}
});
test('DJEN rate limits cause a pause rather than immediate retries across other process queries',async()=>{
 const old=fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}})};
 try{await assert.rejects(queryDjen(p),/limitou/);await assert.rejects(queryDjen(p),/limitou/);assert.equal(calls,1);}finally{globalThis.fetch=old;}
});
