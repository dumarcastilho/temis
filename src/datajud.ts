import type { Env, ProcessRow } from './env';
import type { Movement } from './sources';
import { courtCatalog } from './court-catalog.js';
import { SourceError } from './mni.js';
import { boundedResponse } from './source-http';
import tpu from './tpu-movements.json';
import { filedDate, infoText, namedCode, type CaseInformation } from './information-types';

const ACCESS = 'https://datajud-wiki.cnj.jus.br/api-publica/acesso/';
let publicKey: { value: string; expires: number } | undefined;
export const datajudEnabled = (env: Env): boolean => env.DATAJUD_ENABLED !== 'false';

async function accessKey(env: Env): Promise<string> {
  const configured = env.DATAJUD_API_KEY?.trim().replace(/^APIKey\s+/i, '');
  if (configured) {
    if (!/^[A-Za-z0-9+/=]{16,512}$/.test(configured)) throw new SourceError('Chave de acesso DataJud inválida na configuração.');
    return configured;
  }
  if (publicKey && publicKey.expires > Date.now()) return publicKey.value;
  try {
    const response = await fetch(ACCESS, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const html = await boundedResponse(response);
    const key = html.replace(/<[^>]*>/g, ' ').match(/APIKey\s+([A-Za-z0-9+/=]{16,512})/)?.[1];
    if (!key) throw new Error();
    publicKey = { value: key, expires: Date.now() + 30 * 60000 };
    return key;
  } catch { throw new SourceError('Não foi possível obter a chave pública do CNJ. Configure DATAJUD_API_KEY no Worker com a chave atual publicada na documentação do DataJud.'); }
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
};
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const date = (value: unknown): string => {
  const s = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) throw new SourceError('Data de movimentação inválida no DataJud.');
  const calendar = new Date(Date.UTC(Number(s.slice(0,4)), Number(s.slice(5,7)) - 1, Number(s.slice(8,10)))).toISOString().slice(0,10);
  if (calendar !== s.slice(0,10) || Number(s.slice(11,13)) > 23 || Number(s.slice(14,16)) > 59 || Number(s.slice(17,19)) > 59) throw new SourceError('Data de movimentação inválida no DataJud.');
  return new Date(s).toISOString();
};

export async function queryDatajud(process: ProcessRow, env: Env, includeMovements = true): Promise<{ movements: Movement[]; municipalityCode: string; updatedAt: string | null; information: CaseInformation }> {
  if (!courtCatalog.some(c => c.id === process.tribunal) || !/^\d{20}$/.test(process.number)) throw new SourceError('Tribunal ou número não permitido na consulta DataJud.');
  const grades = process.instance === '1g' ? ['G1', 'JE'] : ['G2', 'TR'];
  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${process.tribunal}/_search`;
  let key = await accessKey(env);
  const records: any[] = [];
  const recordIds = new Set<string>();
  let total = 0;
  for (let page = 0; page < 10; page++) {
    const body = JSON.stringify({ size: 20, from: page * 20, track_total_hits: true, query: { bool: { filter: [{ match: { numeroProcesso: process.number } }, { bool: { should: grades.map(grau => ({ match: { grau } })), minimum_should_match: 1 } }] } }, _source: ['numeroProcesso','grau','dataHoraUltimaAtualizacao','@timestamp','orgaoJulgador','classe','assuntos','dataAjuizamento','sistema','formato',...(includeMovements ? ['movimentos'] : [])] });
    const request = () => fetch(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', Authorization: `APIKey ${key}` }, body });
    let response: Response;
    try { response = await request(); }
    catch { throw new SourceError('Não foi possível conectar ao DataJud dentro do prazo.'); }
    if (response.status === 401 && !env.DATAJUD_API_KEY) {
      publicKey = undefined; key = await accessKey(env);
      try { response = await request(); } catch { throw new SourceError('Não foi possível conectar ao DataJud dentro do prazo.'); }
    }
    if (!response.ok) throw new SourceError(`DataJud indisponível ou acesso recusado (HTTP ${response.status}).`);
    let data: any;
    try { data = JSON.parse(await boundedResponse(response)); }
    catch { throw new SourceError('Resposta inválida do DataJud.'); }
    const hits = data.hits?.hits;
    const count = typeof data.hits?.total === 'number' ? data.hits.total : data.hits?.total?.value;
    if (data.timed_out !== false || data._shards?.failed !== 0 || !Array.isArray(hits) || !Number.isInteger(count) || count < 0 || data.hits?.total?.relation && data.hits.total.relation !== 'eq') throw new SourceError('O DataJud não confirmou uma consulta completa.');
    if (page > 0 && total !== count) throw new SourceError('O histórico DataJud mudou durante a consulta; tente novamente.');
    total = count;
    for (const hit of hits) {
      if (typeof hit?._id !== 'string' || !hit._id || recordIds.has(hit._id)) throw new SourceError('O DataJud retornou uma página repetida ou sem identificadores válidos.');
      recordIds.add(hit._id);
      const record = hit?._source;
      if (!record || record.numeroProcesso !== process.number || !grades.includes(record.grau) || includeMovements && !Array.isArray(record.movimentos)) throw new SourceError('O DataJud não retornou um histórico válido para este processo e instância.');
      records.push(record);
    }
    if (records.length > total) throw new SourceError('Contagem inconsistente na resposta DataJud.');
    if (records.length >= total) break;
    if (!hits.length || page === 9) throw new SourceError('Histórico DataJud incompleto; consulta não confirmada.');
  }
  if (!records.length) throw new SourceError('Processo ainda não localizado no DataJud nesta instância. A base pode ter atraso em relação ao tribunal.');
  const updated = (record: any): number => Math.max(Date.parse(record.dataHoraUltimaAtualizacao) || 0, Date.parse(record['@timestamp']) || 0);
  records.sort((a, b) => updated(b) - updated(a));
  const movements: Movement[] = [];
  const seen = new Set<string>();
  let updatedAt: string | null = null, municipalityCode = '';
  for (const record of records) {
    for (const value of [record.dataHoraUltimaAtualizacao, record['@timestamp']]) {
      if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
        const d = new Date(value).toISOString(); if (!updatedAt || d > updatedAt) updatedAt = d;
      }
    }
    const code = String(record.orgaoJulgador?.codigoMunicipioIBGE || '');
    if (!municipalityCode && /^\d{7}$/.test(code)) municipalityCode = code;
    for (const movement of includeMovements ? record.movimentos : []) {
      const code = String(movement?.codigo || '');
      if (!/^\d+$/.test(code)) throw new SourceError('Código de movimentação inválido no DataJud.');
      const occurred = date(movement.dataHora);
      const complements = movement.complementosTabelados ?? [];
      if (!Array.isArray(complements)) throw new SourceError('Complemento de movimentação inválido no DataJud.');
      const title = clean(movement.nome) || (tpu.movements as Record<string, string>)[code] || `Movimento ${code}`;
      const details = complements.map((c: any) => [...new Set([clean(c?.descricao), clean(c?.nome), clean(c?.valor)].filter(Boolean))].join(': ')).filter(Boolean);
      const description = [title, ...details].join(' · ').slice(0, 4000);
      const stableComplements = complements.map(canonical).sort();
      const key = canonical(['datajud', code, occurred, stableComplements, String(movement.orgaoJulgador?.codigo ?? '')]);
      if (!seen.has(key)) { seen.add(key); movements.push({ key, date: occurred, description }); }
    }
  }
  const newest = records[0];
  const information: CaseInformation = {
    caseClass: namedCode(newest.classe),
    subjects: Array.isArray(newest.assuntos) ? newest.assuntos.slice(0,100).map(namedCode).filter(Boolean) : [],
    courtUnit: namedCode(newest.orgaoJulgador),
    filedAt: filedDate(newest.dataAjuizamento),
    system: infoText(newest.sistema?.nome),
    format: infoText(newest.formato?.nome),
  };
  return { movements, municipalityCode, updatedAt, information };
}
