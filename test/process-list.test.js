import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processListText, sortProcessList } from '../public/process-list.js';

const rows = [
  { number: '99999990020998209999', tribunal: 'tjrn', locality: 'Comarca B', instance: '1g', active: 0, last_error: 'Erro que não deve constar na lista', latest_movement: 'Andamento que não deve constar na lista' },
  { number: '99999990020998059999', tribunal: 'tjba', locality: 'Comarca A', instance: '1g', label: 'Identificação interna', notes: 'Anotação privada' },
];

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
