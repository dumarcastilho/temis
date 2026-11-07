import { XMLParser, XMLValidator } from 'fast-xml-parser';
import tpu from './tpu-movements.json' with { type: 'json' };
import caseTpu from './tpu-case-information.json' with { type: 'json' };

export class SourceError extends Error {
  constructor(message, allowFallback = true) { super(message); this.allowFallback = allowFallback; }
}

// CXF can return a SOAP envelope as the root MIME part even when no documents were requested.
export function soapXml(body, contentType = '') {
  if (!/^multipart\/related(?:\s*;|$)/i.test(contentType)) return body;
  const parameter = name => {
    const match = contentType.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"\\r\\n]*)"|([^;\\s]+))`, 'i'));
    return match ? match[1] ?? match[2] : '';
  };
  const boundary = parameter('boundary');
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) throw new SourceError('Resposta multipart MNI sem delimitador válido.');
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const delimiter = new RegExp(`(?:^|\\r?\\n)--${escaped}(--)?[ \\t]*(?:\\r?\\n|$)`, 'g');
  const markers = [];
  for (const match of body.matchAll(delimiter)) {
    markers.push({ start: match.index, end: match.index + match[0].length, closing: !!match[1] });
    if (markers.length > 64) throw new SourceError('Resposta multipart MNI com partes demais.');
  }
  if (markers.length < 2 || !markers.at(-1).closing) throw new SourceError('Resposta multipart MNI incompleta.');
  const rootId = parameter('start');
  for (let i = 0; i < markers.length - 1; i++) {
    if (markers[i].closing) break;
    const part = body.slice(markers[i].end, markers[i + 1].start);
    const separator = /\r?\n\r?\n/.exec(part);
    if (!separator) continue;
    const header = part.slice(0, separator.index).replace(/\r?\n[ \t]+/g, ' ');
    const headers = new Map(header.split(/\r?\n/).map(line => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
    }));
    if (rootId && headers.get('content-id') !== rootId) continue;
    if (!rootId && i !== 0) continue;
    if (!/^(?:text\/xml|application\/(?:xop\+xml|soap\+xml|xml))(?:\s*;|$)/i.test(headers.get('content-type') || '')) {
      throw new SourceError('Parte principal da resposta MNI não contém XML SOAP.');
    }
    const payload = part.slice(separator.index + separator[0].length).trim();
    const encoding = (headers.get('content-transfer-encoding') || 'binary').toLowerCase();
    if (['binary', '8bit', '7bit'].includes(encoding)) return payload;
    if (encoding === 'base64') {
      try { return new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/\s/g, '')), c => c.charCodeAt(0))); }
      catch { throw new SourceError('Parte XML MNI contém base64 inválido.'); }
    }
    throw new SourceError('Codificação da resposta multipart MNI não suportada.');
  }
  throw new SourceError('Parte principal ausente na resposta multipart MNI.');
}

export const escapeXml = (value) => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function envelope(number, connector) {
  const credentials = `${connector.username ? `<tip:idConsultante>${escapeXml(connector.username)}</tip:idConsultante>` : ''}${connector.password ? `<tip:senhaConsultante>${escapeXml(connector.password)}</tip:senhaConsultante>` : ''}`;
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/" xmlns:tip="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2"><soap:Body><ser:consultarProcesso>${credentials}<tip:numeroProcesso>${escapeXml(number)}</tip:numeroProcesso><tip:movimentos>true</tip:movimentos><tip:incluirCabecalho>true</tip:incluirCabecalho></ser:consultarProcesso></soap:Body></soap:Envelope>`;
}

export function mniDate(value) {
  const s = String(value || '');
  if (/^\d{14}$/.test(s)) {
    // MNI uses local court time in compact timestamps. Initial courts use UTC-3,
    // except Mato Grosso (UTC-4), supplied explicitly by parseMni.
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) throw new SourceError('Data de movimentação fora do formato esperado.');
  return s;
}

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
export function parseMniProcess(xml, number, offset = '-03:00') {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new SourceError('Resposta XML inválida do tribunal.');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false }).parse(xml);
  const body = parsed.Envelope?.Body;
  if (body?.Fault) throw new SourceError('O serviço MNI retornou uma falha. Verifique o acesso do conector.');
  const result = body?.consultarProcessoResposta;
  if (!result || !['true', '1'].includes(String(result.sucesso))) throw new SourceError('Consulta não autorizada ou processo não localizado pelo tribunal.');
  const process = result.processo;
  if (!process || String(process.dadosBasicos?.['@_numero']).replace(/\D/g, '') !== number) throw new SourceError('O tribunal não retornou o processo solicitado.');
  if (Number(process.dadosBasicos?.['@_nivelSigilo'] || 0) > 0) throw new SourceError('O tribunal informou que o processo não permite consulta pública.', false);
  const rawCode = String(process.dadosBasicos?.orgaoJulgador?.['@_codigoMunicipioIBGE'] || '');
  const municipalityCode = /^\d{7}$/.test(rawCode) ? rawCode : '';
  const stateCode = municipalityCode.slice(0, 2);
  const knownState = ['11','12','13','14','15','16','17','21','22','23','24','25','26','27','28','29','31','32','33','35','41','42','43','50','51','52','53'].includes(stateCode);
  const effectiveOffset = knownState ? ({ '12': '-05:00', '11': '-04:00', '13': '-04:00', '14': '-04:00', '50': '-04:00', '51': '-04:00' }[stateCode] || '-03:00') : offset;
  const movements = list(process.movimento).filter(m => !Number(m['@_nivelSigilo'] || 0)).map(m => {
    const rawDate = mniDate(m['@_dataHora']);
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate);
    if (!hasOffset && effectiveOffset === 'auto') throw new SourceError('O tribunal não informou o município ou fuso necessário para interpretar as datas deste processo.');
    const date = hasOffset ? rawDate : rawDate + effectiveOffset;
    if (!Number.isFinite(Date.parse(date))) throw new SourceError('Data inválida na resposta do tribunal.');
    const national = m.movimentoNacional;
    const local = m.movimentoLocal;
    const code = national?.['@_codigoNacional'] || local?.['@_codigoMovimento'] || '';
    const complements = list(m.complemento).map(c => typeof c === 'string' ? c : c['#text'] || c['@_descricao'] || '').filter(Boolean);
    const provided = local?.['@_descricao'] || national?.['@_descricao'] || m['@_descricao'];
    const legacyDescription = [provided || (code ? `Movimento ${code}` : ''), ...complements].filter(Boolean).join(' · ');
    // Resolve national codes only: local tribunal codes can have different meanings.
    const description = [provided || (national && tpu.movements[code]) || (code ? `Movimento ${code}` : ''), ...complements].filter(Boolean).join(' · ');
    if (!description) throw new SourceError('Movimentação sem descrição ou código.');
    // Preserve the previous identity so label enrichment does not create duplicate alerts.
    return { key: JSON.stringify([m['@_identificadorMovimento'] || '', date, code, legacyDescription]), date: new Date(date).toISOString(), description: description.slice(0, 4000) };
  });
  const basics = process.dadosBasicos;
  const classCode = String(basics['@_classeProcessual'] || '');
  const subjects = list(basics.assunto).map(a => {
    const code = String(a.codigoNacional || '');
    return { code, name: caseTpu.assuntos.names[code] || '' };
  }).filter(a => /^\d+$/.test(a.code));
  const filed = String(basics['@_dataAjuizamento'] || '');
  const information = {
    caseClass: /^\d+$/.test(classCode) ? { code: classCode, name: caseTpu.classes.names[classCode] || '' } : undefined,
    subjects: subjects.slice(0,100),
    courtUnit: basics.orgaoJulgador ? { code: String(basics.orgaoJulgador['@_codigoOrgao'] || ''), name: String(basics.orgaoJulgador['@_nomeOrgao'] || '').slice(0,240) } : undefined,
    filedAt: /^\d{14}$/.test(filed) ? `${filed.slice(0,4)}-${filed.slice(4,6)}-${filed.slice(6,8)}` : /^\d{4}-\d{2}-\d{2}/.test(filed) ? filed.slice(0,10) : undefined,
  };
  return { movements, municipalityCode, information };
}

export function parseMni(xml, number, offset = '-03:00') {
  return parseMniProcess(xml, number, offset).movements;
}
