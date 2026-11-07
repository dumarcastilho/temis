import type { ProcessRow } from './env';
import { courtCatalog } from './court-catalog.js';
import { boundedResponse } from './source-http';
import { infoText, filedDate } from './information-types';
import { SourceError } from './mni.js';

export class InformationRateLimit extends SourceError {
  retrySeconds: number;
  constructor(seconds: number) { super('O DJEN limitou temporariamente as consultas. Aguarde antes de tentar novamente.'); this.retrySeconds = Math.max(60, Math.min(3600, seconds)); }
}
let blockedUntil = 0;
export interface Publication {
  id: string; publishedOn: string; type: string; courtUnit: string; text: string;
  active: boolean; link: string; recipients: string[]; lawyers: string[]; truncated: boolean;
}
function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\s*(?:br|\/p|\/div|\/li)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, code) => {
      const entities: Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
      if (code[0] !== '#') return entities[code.toLowerCase()] ?? full;
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : Number(code.slice(1));
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
    }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
}
function officialLink(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname.endsWith('.jus.br') && !url.username && !url.password && !url.port && url.href.length < 2500 ? url.href : '';
  } catch { return ''; }
}
export async function queryDjen(process: ProcessRow): Promise<{ publications: Publication[]; total: number; limited: boolean; since: string; until: string }> {
  if (!/^\d{20}$/.test(process.number) || !courtCatalog.some(c => c.id === process.tribunal)) throw new SourceError('Processo não permitido na consulta DJEN.');
  const until = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const since = new Date(Date.parse(until+'T12:00:00Z') - 365*86400000).toISOString().slice(0,10);
  const items: Publication[] = [], seen = new Set<string>();
  let total = 0, received = 0, bytes = 0, limited = false;
  for (let page = 1; page <= 2; page++) {
    if (Date.now() < blockedUntil) throw new InformationRateLimit(Math.ceil((blockedUntil-Date.now())/1000));
    const params = new URLSearchParams({numeroProcesso:process.number,siglaTribunal:process.tribunal.toUpperCase(),pagina:String(page),itensPorPagina:'100',dataDisponibilizacaoInicio:since,dataDisponibilizacaoFim:until});
    const response = await fetch('https://comunicaapi.pje.jus.br/api/v1/comunicacao?'+params,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    if (response.status === 429) {
      const error=new InformationRateLimit(Number(response.headers.get('Retry-After')) || 60);
      blockedUntil=Date.now()+error.retrySeconds*1000; throw error;
    }
    if (response.headers.get('x-ratelimit-remaining') === '0') blockedUntil=Date.now()+60000;
    if (!response.ok) throw new SourceError(`Consulta DJEN indisponível (HTTP ${response.status}).`);
    let result: any;
    try { result = JSON.parse(await boundedResponse(response)); } catch { throw new SourceError('Resposta DJEN inválida.'); }
    if (result.status !== 'success' || !Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.items)) throw new SourceError('O DJEN não confirmou uma resposta de consulta válida.');
    if (page > 1 && result.count !== total) throw new SourceError('As publicações mudaram durante a consulta DJEN. Tente novamente.');
    total = result.count;
    for (const row of result.items) {
      const id = String(row?.id ?? '');
      const publishedOn = filedDate(row?.data_disponibilizacao);
      if (!/^\d+$/.test(id) || seen.has(id) || typeof row.numero_processo !== 'string' || row.numero_processo.replace(/\D/g,'') !== process.number || row.siglaTribunal?.toLowerCase() !== process.tribunal || !publishedOn || publishedOn < since || publishedOn > until || typeof row.ativo !== 'boolean') throw new SourceError('Publicação DJEN não corresponde ao processo ou está fora do formato esperado.');
      seen.add(id); received++;
      const fullText = plainText(row.texto);
      const publication: Publication = {
        id, publishedOn, active: row.ativo, type: infoText(row.tipoComunicacao) || 'Publicação', courtUnit: infoText(row.nomeOrgao),
        text: fullText.slice(0,12000), truncated: fullText.length > 12000, link: officialLink(row.link),
        recipients: Array.isArray(row.destinatarios) ? row.destinatarios.slice(0,20).map((v: any)=>infoText(v?.nome)).filter(Boolean) : [],
        lawyers: Array.isArray(row.destinatarioadvogados) ? row.destinatarioadvogados.slice(0,20).map((v: any)=>infoText(v?.advogado?.nome)).filter(Boolean) : [],
      };
      const size = new TextEncoder().encode(JSON.stringify(publication)).byteLength;
      if (items.length < 50 && bytes + size <= 500000) { items.push(publication); bytes += size; } else limited = true;
    }
    if (received > total) throw new SourceError('Contagem inconsistente na resposta DJEN.');
    if (received >= total) break;
    if (!result.items.length) throw new SourceError('Consulta DJEN incompleta.');
    if (page === 2) limited = true;
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    if (response.headers.has('x-ratelimit-remaining') && remaining <= 0) throw new InformationRateLimit(60);
  }
  items.sort((a,b)=>b.publishedOn.localeCompare(a.publishedOn));
  return {publications:items,total,limited,since,until};
}
