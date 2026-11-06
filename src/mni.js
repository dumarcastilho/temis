import { XMLParser, XMLValidator } from 'fast-xml-parser';

export class SourceError extends Error {}
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
export function parseMni(xml, number, offset = '-03:00') {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new SourceError('Resposta XML inválida do tribunal.');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false }).parse(xml);
  const body = parsed.Envelope?.Body;
  if (body?.Fault) throw new SourceError('O serviço MNI retornou uma falha. Verifique o acesso do conector.');
  const result = body?.consultarProcessoResposta;
  if (!result || !['true', '1'].includes(String(result.sucesso))) throw new SourceError('Consulta não autorizada ou processo não localizado pelo tribunal.');
  const process = result.processo;
  if (!process || String(process.dadosBasicos?.['@_numero']).replace(/\D/g, '') !== number) throw new SourceError('O tribunal não retornou o processo solicitado.');
  return list(process.movimento).filter(m => !Number(m['@_nivelSigilo'] || 0)).map(m => {
    const rawDate = mniDate(m['@_dataHora']);
    const date = /(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate) ? rawDate : rawDate + offset;
    if (!Number.isFinite(Date.parse(date))) throw new SourceError('Data inválida na resposta do tribunal.');
    const national = m.movimentoNacional;
    const local = m.movimentoLocal;
    const code = national?.['@_codigoNacional'] || local?.['@_codigoMovimento'] || '';
    const complements = list(m.complemento).map(c => typeof c === 'string' ? c : c['#text'] || c['@_descricao'] || '').filter(Boolean);
    const description = [local?.['@_descricao'] || national?.['@_descricao'] || m['@_descricao'] || (code ? `Movimento ${code}` : ''), ...complements].filter(Boolean).join(' · ');
    if (!description) throw new SourceError('Movimentação sem descrição ou código.');
    return { key: JSON.stringify([m['@_identificadorMovimento'] || '', date, code, description]), date: new Date(date).toISOString(), description: description.slice(0, 4000) };
  });
}
