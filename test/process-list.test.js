import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processListText, sortProcessList, formatLocality } from '../public/process-list.js';

const rows = [
  { number: '99999990020998209999', tribunal: 'tjrn', locality: 'Comarca B', instance: '1g', active: 0, last_error: 'Erro que não deve constar na lista', latest_movement: 'Andamento que não deve constar na lista' },
  { number: '99999990020998059999', tribunal: 'tjba', locality: 'Comarca A', instance: '1g', label: 'Identificação interna', notes: 'Anotação privada' },
];

test('locality names keep accents and Portuguese connectors in display and copied lists', () => {
  for (const [input, expected] of [
    ['VÁRZEA GRANDE', 'Várzea Grande'],
    ['SÃO BENTO DO NORTE', 'São Bento do Norte'],
    ['  olinda  ', 'Olinda'],
    ['LAGOA D’ANTA', 'Lagoa D’Anta'],
    ['SANTA BÁRBARA D\'OESTE', 'Santa Bárbara D\'Oeste'],
    ['SÃO JOÃO DA BOA VISTA', 'São João da Boa Vista'],
    ['', ''],
    [undefined, ''],
  ]) assert.equal(formatLocality(input), expected);
  assert.ok(processListText([{ ...rows[0], locality: 'SÃO BENTO DO NORTE' }]).includes('São Bento do Norte'));
});

test('simple list sorts a copy by state and locality, keeping paused cases and excluding progress and private notes from copied text', () => {
  const sorted = sortProcessList(rows);
  assert.equal(sorted[0].tribunal, 'tjba'); assert.equal(rows[0].tribunal, 'tjrn');
  const text = processListText(rows);
  assert.equal(text, 'BA\nComarca A\n9999999-00.2099.8.05.9999\n\nRN\nComarca B\n9999999-00.2099.8.20.9999');
  for (const excluded of ['Andamento', 'Erro', 'Anotação', 'Identificação']) assert.ok(!text.includes(excluded));
});

test('missing localities and second-instance entries remain unambiguous', () => {
  assert.equal(processListText([]), '');
  const text = processListText([{ ...rows[0], locality: '', instance: '2g' }]);
  assert.ok(text.includes('Comarca não informada')); assert.ok(text.endsWith('2º grau'));
});
