import type { Env, ProcessRow } from './env';
import { connectors, validateEndpoint } from './courts';
import { envelope, parseMni, soapXml, SourceError } from './mni.js';

export interface Movement { key: string; date: string; description: string }
const TJMT = 'https://hellsgate.tjmt.jus.br/consultaprocessual/ProcessosJudiciais';

async function boundedResponse(response: Response): Promise<string> {
  if (response.status >= 300 && response.status < 400) throw new SourceError('O tribunal redirecionou a consulta. O histórico não foi alterado; verifique a disponibilidade do serviço.');
  if (!response.ok) throw new SourceError(`Tribunal indisponível (HTTP ${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError('Tribunal retornou resposta vazia.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8_000_000) { await reader.cancel(); throw new SourceError('Resposta do tribunal excede o limite de consulta.'); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(joined);
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  try { return JSON.parse(await boundedResponse(response)); }
  catch (error) { if (error instanceof SourceError) throw error; throw new SourceError('Formato inesperado na consulta TJMT.'); }
}

export async function queryTjmt(number: string, instance: string): Promise<Movement[]> {
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
  for (const record of matches) {
    const code = String(record.codigoProcessoStr || '');
    if (!/^\d+$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const detail = await getJson(`${TJMT}/${number}/${code}`);
    if (detail.numeroUnico !== number || detail.segredo || !Array.isArray(detail.eventos)) throw new SourceError('TJMT não retornou histórico público válido.');
    for (const event of detail.eventos) {
      if (event?.sigilo) continue;
      if (!event || typeof event.data !== 'string' || !Number.isFinite(Date.parse(event.data))) throw new SourceError('Evento TJMT fora do formato esperado.');
      // Legacy systems may provide only the event type, with a null or blank description.
      const description = (typeof event.descricao === 'string' && event.descricao.trim()) || (typeof event.tipo === 'string' && event.tipo.trim()) || 'Movimentação sem descrição no tribunal';
      movements.push({ key: JSON.stringify(['tjmt', code, event.idProcessoEvento, event.data, description]), date: new Date(event.data).toISOString(), description: description.slice(0, 4000) });
    }
  }
  if (!seen.size) throw new SourceError('TJMT não retornou identificadores válidos.');
  return movements;
}

export async function querySource(process: ProcessRow, env: Env): Promise<Movement[]> {
  if (process.tribunal === 'tjmt') return queryTjmt(process.number, process.instance);
  const connector = connectors(env)[`${process.tribunal}:${process.instance}`];
  if (!connector) throw new SourceError('Integração direta deste tribunal/instância aguarda configuração e validação.');
  const endpoint = validateEndpoint(connector.endpoint);
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/consultarProcesso"' },
    body: envelope(process.number, connector),
  });
  const xml = soapXml(await boundedResponse(response), response.headers.get('content-type') || '');
  return parseMni(xml, process.number, process.tribunal === 'tjmt' ? '-04:00' : '-03:00');
}
