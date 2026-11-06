import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { courtCatalog } from '../src/court-catalog.js';
import { normalizeNumber, tribunalFor } from '../src/cnj.js';
const result = await build({ entryPoints: ['src/courts.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24' });
const { connectors, courts } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

test('the 57 courts map their CNJ branches independently, including DF and regional boundaries', () => {
  const states = ['tjac','tjal','tjap','tjam','tjba','tjce','tjdft','tjes','tjgo','tjma','tjmt','tjms','tjmg','tjpa','tjpb','tjpr','tjpe','tjpi','tjrj','tjrn','tjrs','tjro','tjrr','tjsc','tjse','tjsp','tjto'];
  const expected = [...states.map((id,i) => ['8',i+1,id]), ...Array.from({length:6},(_,i)=>['4',i+1,`trf${i+1}`]), ...Array.from({length:24},(_,i)=>['5',i+1,`trt${i+1}`])];
  assert.equal(courtCatalog.length, expected.length);
  for (const [branch, code, id] of expected) {
    const suffix = `2099${branch}${String(code).padStart(2,'0')}9999`;
    let mod = 0; for (const digit of '9999999' + suffix + '00') mod = (mod * 10 + Number(digit)) % 97;
    const number = '9999999' + String(98-mod).padStart(2,'0') + suffix;
    assert.equal(tribunalFor(normalizeNumber(number)), id);
    assert.equal(courts.find(c=>c.id===id).cnjCode, String(code).padStart(2,'0'));
  }
  for (const [branch,code] of [['8','00'],['8','28'],['4','07'],['5','25'],['6','01'],['3','00']]) assert.throws(()=>tribunalFor(`9999999002099${branch}${code}9999`));
});

test('restricted service profiles require explicit configuration and never expose credentials through court metadata', () => {
  for (const id of ['tjpi','tjes','tjam','trf1','trt6','trt15']) assert.equal(connectors({})[`${id}:1g`], undefined);
  const configured = connectors({ COURT_CONNECTORS: JSON.stringify({'trt6:1g': {username:'synthetic',password:'synthetic-secret'}}) });
  assert.equal(configured['trt6:1g'].endpoint, 'https://pje.trt6.jus.br/primeirograu/servicosweb/mni222/intercomunicacao');
  assert.ok(!JSON.stringify(courts).includes('synthetic-secret'));
  for (const config of [[], null, {'unknown:1g': {endpoint:'https://official.jus.br/service'}}, {'trt6:1g': {password:12}}, {'trf6:1g': {}}, {'trt6:1g':{endpoint:'http://pje.trt6.jus.br/service'}}]) {
    assert.throws(()=>connectors({COURT_CONNECTORS:JSON.stringify(config)}), /Configuração/);
  }
});
