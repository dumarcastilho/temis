import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoProcess, parseGoMovements } from '../src/projudi.js';

const number = '99999990020998099999';
const record = (n = number, secrecy = 'false') => `<dadosProcesso><numero>${n}</numero><idProcesso>999</idProcesso><hashProcesso>synthetic+hash=</hashProcesso><outrasInformacoes><segredoJustica>${secrecy}</segredoJustica><serventia>Unidade sintética</serventia></outrasInformacoes></dadosProcesso>`;
const processXml = content => `<resposta operacao="74" versao="1"><processos>${content}</processos></resposta>`;
const movement = (date = '06/11/2099 12:30:15') => `<Movimentacao><IdMovimentacao>7</IdMovimentacao><DescricaoMovimentacao>Movimento sintético</DescricaoMovimentacao><Complemento>Complemento sintético</Complemento><DataRealizacao>${date}</DataRealizacao><NomeUsuarioRealizador>Não deve integrar a descrição</NomeUsuarioRealizador></Movimentacao>`;
const history = (content, pagination = '') => `<resposta operacao="75" versao="1"><situacao>OK</situacao><mensagem><paginacao>${pagination}</paginacao><lista>${content}</lista></mensagem></resposta>`;

test('Projudi identifies the requested public process with full or simplified CNJ and preserves its access identifiers', () => {
  for (const n of [number, '9999999-00.2099']) assert.deepEqual(parseGoProcess(processXml(record(n)), number), { id: '999', hash: 'synthetic+hash=' });
});

test('Projudi refuses wrong cases, ambiguous records, secrecy, missing fields, HTML and unexpected operations', () => {
  for (const xml of [processXml(''), processXml(record('9999999-01.2099')), processXml(record() + record()), processXml(record(number, 'true')), processXml(record(number, '')), processXml(record().replace('<idProcesso>999</idProcesso>', '')), '<html>Login</html>', '<!DOCTYPE resposta><resposta/>', processXml(record()).replace('74', '75')]) {
    assert.throws(() => parseGoProcess(xml, number));
  }
});

test('Projudi parses the documented movement contract, preserves stable identities and permits an explicit empty history', () => {
  const rows = parseGoMovements(history(movement()), '999');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2099-11-06T15:30:15.000Z');
  assert.equal(rows[0].description, 'Movimento sintético · Complemento sintético');
  assert.equal(rows[0].key, parseGoMovements(history(movement()), '999')[0].key);
  assert.deepEqual(parseGoMovements(history(''), '999'), []);
});

test('Projudi refuses incomplete or paginated histories and malformed dates instead of confirming a partial baseline', () => {
  for (const xml of [history(movement(), '<proxima>1</proxima>'), history('<erro>Resposta incompleta</erro>'), history(movement('31/02/2099 12:30:15')), history(movement('ontem')), history(movement()).replace('<IdMovimentacao>7</IdMovimentacao>', ''), '<resposta operacao="75" versao="1"><situacao>OK</situacao></resposta>']) {
    assert.throws(() => parseGoMovements(xml, '999'));
  }
});
