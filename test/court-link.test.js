import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtProcessLink } from '../public/court-link.js';
const number='99999990020998119999';
test('court links include the CNJ in supported URLs and distinguish genuine detail URLs from public-search pages',()=>{
 const mt=courtProcessLink({number,tribunal:'tjmt'},{});assert.equal(new URL(mt.url).searchParams.get('numeroUnico'),number);assert.equal(mt.detail,true);
 const pe=courtProcessLink({number,tribunal:'tjpe'},{url:'https://pje.cloud.tjpe.jus.br/1g/ConsultaPublica/listView.seam'});assert.equal(new URL(pe.url).searchParams.get('numeroProcesso'),'9999999-00.2099.8.11.9999');assert.equal(pe.detail,false);assert.match(pe.help,/CAPTCHA/);
 const go=courtProcessLink({number,tribunal:'tjgo'},{url:'https://projudi.tjgo.jus.br/BuscaProcesso'});assert.equal(new URL(go.url).searchParams.get('ProcessoNumero'),'9999999-00.2099.8.11.9999');
 const fallback=courtProcessLink({number,tribunal:'trt6'},{url:'https://www.trt6.jus.br/'});assert.equal(fallback.url,'https://www.trt6.jus.br/');assert.equal(fallback.detail,false);
 assert.throws(()=>courtProcessLink({number:'invalid',tribunal:'tjmt'},{}));assert.throws(()=>courtProcessLink({number,tribunal:'tjpe'},{url:'https://other.example.invalid/'}));
});
