import { writeFile } from 'node:fs/promises';
const source = 'https://gateway.cloud.pje.jus.br/tpu/api/v1/publico/download/movimentos';
const response = await fetch(source, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Não foi possível obter a tabela oficial de movimentos.');
const rows = await response.json();
if (!Array.isArray(rows) || rows.length < 500) throw new Error('Tabela TPU incompleta ou fora do contrato.');
const movements = {};
for (const row of rows) {
  if (!Number.isInteger(row.id) || row.id < 1 || typeof row.nome !== 'string' || !row.nome.trim()) throw new Error('Registro TPU inválido.');
  if (movements[row.id]) throw new Error('Código TPU repetido.');
  movements[row.id] = row.nome.trim();
}
const version = rows.map(r => r.data_versao).filter(v => typeof v === 'string').sort().at(-1);
await writeFile(new URL('../src/tpu-movements.json', import.meta.url), JSON.stringify({ source, version, movements }, null, 2) + '\n');
console.log(`${rows.length} nomes de movimentos TPU atualizados.`);

const information = {};
for (const kind of ['classes','assuntos']) {
  const source = `https://gateway.cloud.pje.jus.br/tpu/api/v1/publico/download/${kind}`;
  const response = await fetch(source, {redirect:'manual',signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Não foi possível obter a tabela ${kind}.`);
  const rows = await response.json();
  if (!Array.isArray(rows)||rows.length<100) throw new Error(`Tabela ${kind} incompleta.`);
  const names={};
  for (const row of rows) {
    if(!Number.isInteger(row.cod_item)||row.cod_item<1||typeof row.nome!=='string'||!row.nome.trim()||names[row.cod_item])throw new Error(`Registro inválido na tabela ${kind}.`);
    names[row.cod_item]=row.nome.trim();
  }
  information[kind]={source,version:rows.map(r=>r.data_versao||'').sort().at(-1),names};
}
await writeFile(new URL('../src/tpu-case-information.json',import.meta.url),JSON.stringify(information,null,2)+'\n');
console.log('Nomes de classes e assuntos TPU atualizados.');
