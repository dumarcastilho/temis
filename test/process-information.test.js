import { test } from 'node:test';
import assert from 'node:assert/strict';
import { informationHtml,publicationsHtml } from '../public/process-information.js';
test('information presentation keeps provenance, base dates, optional fields and stale data errors visible without rendering HTML',()=>{
 const row={checkedAt:'2099-01-02T12:00:00Z',updatedAt:'2099-01-01T12:00:00Z',error:'Erro sintético',data:{caseClass:{name:'<img src=x onerror=alert(1)>'},subjects:[{name:'Assunto sintético'}],courtUnit:{name:'Órgão sintético'},filedAt:'2099-01-01'}};
 const html=informationHtml({direct:row,datajud:row});assert.ok(html.includes('Dados do tribunal'));assert.ok(html.includes('Dados do DataJud'));assert.ok(html.includes('Atualização da base'));assert.ok(html.includes('dados anteriores foram preservados'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Assunto sintético'));
});
test('publication presentation distinguishes canceled and limited results and refuses non-official links',()=>{
 const html=publicationsHtml({checkedAt:'2099-01-02T12:00:00Z',data:{since:'2098-01-01',until:'2099-01-01',total:2,limited:true,publications:[{id:'1',active:false,publishedOn:'2099-01-01',type:'Intimação',text:'<script>unsafe()</script>',link:'javascript:alert(1)',truncated:true}]}});
 assert.ok(html.includes('Cancelada / inativa'));assert.ok(html.includes('exibição foi limitada'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript'));assert.ok(html.includes('Texto resumido'));
});
