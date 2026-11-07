import type { Env, ProcessRow } from './env';
import { connectors, courts, validateEndpoint } from './courts';
import { envelope, parseMniProcess, soapXml, SourceError } from './mni.js';
import { parseGoProcess, parseGoMovements } from './projudi.js';
import { boundedResponse } from './source-http';
import { queryDatajud, datajudEnabled } from './datajud';
import { filedDate, namedCode, type CaseInformation } from './information-types';

export interface Movement { key: string; date: string; description: string }
export interface ProcessResult { movements: Movement[]; locality: string; source?: 'direct' | 'datajud'; sourceUpdatedAt?: string | null; fallbackReason?: string; information?: CaseInformation }
const TJMT = 'https://hellsgate.tjmt.jus.br/consultaprocessual/ProcessosJudiciais';
const municipalityCache = new Map<string, { name: string; expires: number }>();
const cleanLocality = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '';

async function municipalityName(code: string): Promise<string> {
  if (!/^\d{7}$/.test(code)) return '';
  const cached = municipalityCache.get(code);
  if (cached && cached.expires > Date.now()) return cached.name;
  try {
    const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${code}`, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return '';
    const data = JSON.parse(await boundedResponse(response));
    const name = String(data.id) === code ? cleanLocality(data.nome) : '';
    if (name) {
      if (municipalityCache.size >= 256) municipalityCache.delete(municipalityCache.keys().next().value!);
      municipalityCache.set(code, { name, expires: Date.now() + 7 * 86400000 });
    }
    return name;
  } catch { return ''; } // A missing municipality name must not invalidate a successful court consultation.
}


async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  try { return JSON.parse(await boundedResponse(response)); }
  catch (error) { if (error instanceof SourceError) throw error; throw new SourceError('Formato inesperado na consulta TJMT.'); }
}

export async function queryTjmtProcess(number: string, instance: string): Promise<ProcessResult> {
  const records: any[] = [];
  const take = 20;
  for (let page = 0; page < 10; page++) {
    const data = await getJson(`${TJMT}/v2?numeroUnico=${number}&ExibirArquivados=true&Skip=${page * take}&Take=${take}`);
    if (!Array.isArray(data.itens) || !Number.isInteger(data.totalRegistros) || data.totalRegistros < 0) throw new SourceError('Formato inesperado na listagem TJMT.');
    if (data.itens.some((p: any) => p.numeroUnico !== number)) throw new SourceError('TJMT retornou processos diferentes do solicitado.');
    records.push(...data.itens);
    if (records.length >= data.totalRegistros) break;
    if (data.itens.length === 0 || page === 9) throw new SourceError('Listagem incompleta do TJMT; consulta não confirmada.');
  }
  const matches = records.filter(p => Number(p.idInstancia) === (instance === '2g' ? 2 : 1));
  if (!matches.length) throw new SourceError('Processo não localizado nesta instância do TJMT.');
  const movements: Movement[] = [];
  const seen = new Set<string>();
  let information: CaseInformation | undefined;
  const localities: { name: string; archived: boolean; latest: number }[] = [];
  for (const record of matches) {
    const code = String(record.codigoProcessoStr || '');
    if (!/^\d+$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const detail = await getJson(`${TJMT}/${number}/${code}`);
    if (detail.segredo) throw new SourceError('TJMT informou que o processo não permite consulta pública.', false);
    if (detail.numeroUnico !== number || !Array.isArray(detail.eventos)) throw new SourceError('TJMT não retornou histórico público válido.');
    if (!information || !detail.arquivado) information = { caseClass: namedCode(detail.classeJudicial || detail.classe), subjects: Array.isArray(detail.assuntos) ? detail.assuntos.slice(0,100).map(namedCode).filter(Boolean) : [], courtUnit: namedCode(detail.orgaoJulgador), filedAt: filedDate(detail.dataDistribuicao || detail.dataAutuacao) };
    const name = cleanLocality(detail.jurisdicao?.nome) || cleanLocality(detail.localidade?.descricao) || cleanLocality(record.jurisdicao?.nome);
    if (name) localities.push({ name, archived: !!(detail.arquivado ?? record.arquivado), latest: detail.eventos.reduce((latest: number, e: any) => Math.max(latest, Date.parse(e?.data) || 0), 0) });
    for (const event of detail.eventos) {
      if (event?.sigilo) continue;
      if (!event || typeof event.data !== 'string' || !Number.isFinite(Date.parse(event.data))) throw new SourceError('Evento TJMT fora do formato esperado.');
      // Legacy systems may provide only the event type, with a null or blank description.
      const description = (typeof event.descricao === 'string' && event.descricao.trim()) || (typeof event.tipo === 'string' && event.tipo.trim()) || 'Movimentação sem descrição no tribunal';
      movements.push({ key: JSON.stringify(['tjmt', code, event.idProcessoEvento, event.data, description]), date: new Date(event.data).toISOString(), description: description.slice(0, 4000) });
    }
  }
  if (!seen.size) throw new SourceError('TJMT não retornou identificadores válidos.');
  localities.sort((a, b) => Number(a.archived) - Number(b.archived) || b.latest - a.latest);
  return { movements, locality: localities[0]?.name || '', information };
}

export async function queryTjmt(number: string, instance: string): Promise<Movement[]> {
  return (await queryTjmtProcess(number, instance)).movements;
}

export async function queryTjgoProcess(number: string): Promise<ProcessResult> {
  const base = 'https://projudi.tjgo.jus.br/ServicosPublicos';
  const get = async (params: Record<string, string>): Promise<string> => {
    let response: Response;
    try { response = await fetch(`${base}?${new URLSearchParams(params)}`, { headers: { Accept: 'application/xml, text/xml' }, redirect: 'manual', signal: AbortSignal.timeout(20000) }); }
    catch { throw new SourceError('Não foi possível conectar ao serviço público do TJGO dentro do prazo. Tente novamente mais tarde.'); }
    return boundedResponse(response);
  };
  const simplified = `${number.slice(0, 7)}-${number.slice(7, 9)}.${number.slice(9, 13)}`;
  const process = parseGoProcess(await get({ PaginaAtual: '2', PosicaoPaginaAtual: '0', a: simplified }), number);
  const movements = parseGoMovements(await get({ PaginaAtual: '3', a: process.id, b: process.hash }), process.id);
  // Serventia is a court unit, not a reliable municipality name.
  return { movements, locality: '' };
}

export async function queryDirectProcess(process: ProcessRow, env: Env): Promise<ProcessResult> {
  if (process.tribunal === 'tjmt') return queryTjmtProcess(process.number, process.instance);
  const connector = connectors(env)[`${process.tribunal}:${process.instance}`];
  if (process.tribunal === 'tjgo' && process.instance === '1g' && !connector) return queryTjgoProcess(process.number);
  if (!connector) throw new SourceError('Integração direta deste tribunal/instância aguarda configuração e validação.');
  const endpoint = validateEndpoint(connector.endpoint);
  let response: Response;
  try { response = await fetch(endpoint, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/consultarProcesso"' },
    body: envelope(process.number, connector),
  }); } catch { throw new SourceError('Não foi possível conectar ao serviço MNI do tribunal dentro do prazo. Tente novamente mais tarde; se persistir, confirme o endpoint e as condições de acesso com o tribunal.'); }
  const xml = soapXml(await boundedResponse(response), response.headers.get('content-type') || '');
  const result = parseMniProcess(xml, process.number, courts.find(c => c.id === process.tribunal)?.offset || '-03:00');
  const locality = !process.locality?.trim() && result.municipalityCode ? await municipalityName(result.municipalityCode) : '';
  return { movements: result.movements, locality, information: result.information };
}

export async function queryProcess(process: ProcessRow, env: Env): Promise<ProcessResult> {
  try { return { ...await queryDirectProcess(process, env), source: 'direct', sourceUpdatedAt: null, fallbackReason: '' }; }
  catch (error) {
    if (!datajudEnabled(env) || error instanceof SourceError && !error.allowFallback) throw error;
    const result = await queryDatajud(process, env);
    const locality = !process.locality?.trim() && result.municipalityCode ? await municipalityName(result.municipalityCode) : '';
    return { movements: result.movements, locality, source: 'datajud', sourceUpdatedAt: result.updatedAt, fallbackReason: error instanceof SourceError ? error.message.slice(0, 800) : 'Consulta direta indisponível.', information: result.information };
  }
}

export async function querySource(process: ProcessRow, env: Env): Promise<Movement[]> {
  return (await queryProcess(process, env)).movements;
}
