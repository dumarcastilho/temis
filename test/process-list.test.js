import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processState, processListText, sortProcessList, formatLocality, processTrackingStatus, sortTrackingProcesses, groupProcessesByCourt } from '../public/process-list.js';

const rows = [
  { number: '99999990020998209999', tribunal: 'tjrn', locality: 'Comarca B', instance: '1g', active: 0, last_error: 'Erro que não deve constar na lista', latest_movement: 'Andamento que não deve constar na lista' },
  { number: '99999990020998059999', tribunal: 'tjba', locality: 'Comarca A', instance: '1g', label: 'Identificação interna', notes: 'Anotação privada' },
];

test('tracking groups attention and missing integration before first checks, monitored and paused cases, preserving order within each group', () => {
  const rows = [
    { id: 'monitored-a', active: 1, initialized: 1 },
    { id: 'paused-error', active: 0, initialized: 1, last_error: 'Falha sintética' },
    { id: 'attention', active: 1, initialized: 1, last_error: 'Falha sintética' },
    { id: 'first', active: 1, initialized: 0 },
    { id: 'unconfigured', active: 1, initialized: 0 },
    { id: 'monitored-b', active: 1, initialized: 1 },
  ];
  const originalOrder = rows.map(p => p.id);
  const configured = p => p.id !== 'unconfigured';
  assert.deepEqual(sortTrackingProcesses(rows, configured).map(p => p.id), ['attention', 'unconfigured', 'first', 'monitored-a', 'monitored-b', 'paused-error']);
  assert.deepEqual(rows.map(p => p.id), originalOrder);
  assert.equal(processTrackingStatus(rows[1], true)[1], 'Pausado');
  assert.equal(processTrackingStatus(rows[4], false)[1], 'Integração pendente');
  assert.deepEqual(sortTrackingProcesses([], configured), []);
});

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

test('simple lists identify the Federal District and regional courts without inventing a state', () => {
  assert.equal(processState({ tribunal: 'tjdft' }), 'DF');
  assert.equal(processState({ tribunal: 'trf1' }), 'TRF1');
  assert.equal(processState({ tribunal: 'trt15' }), 'TRT15');
});

test('court grouping preserves the filtered status order inside each court and does not alter the input',()=>{
 const rows=[{tribunal:'tjpe',id:'attention'},{tribunal:'tjgo',id:'other'},{tribunal:'tjpe',id:'monitored'}];
 assert.deepEqual(groupProcessesByCourt(rows),[{tribunal:'tjgo',items:[rows[1]]},{tribunal:'tjpe',items:[rows[0],rows[2]]}]);
 assert.deepEqual(rows.map(p=>p.id),['attention','other','monitored']);assert.deepEqual(groupProcessesByCourt([]),[]);
});
