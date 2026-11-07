import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SourceError } from './mni.js';

const list = value => value == null || value === '' ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value.trim() : '';
const digits = value => text(value).replace(/\D/g, '');

function response(xml, operation) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new SourceError('Resposta XML inválida do Projudi.');
  const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(xml).resposta;
  if (!root || root['@_operacao'] !== operation || root['@_versao'] !== '1') throw new SourceError('Contrato inesperado na resposta do Projudi.');
  return root;
}

export function parseGoProcess(xml, number) {
  const root = response(xml, '74');
  if (root.processos == null) throw new SourceError('Listagem incompleta do Projudi.');
  const records = list(root.processos.dadosProcesso);
  if (!records.length) throw new SourceError('Processo não localizado na consulta pública do TJGO.');
  // Projudi accepts the CNJ sequence, check digits and year as a simplified number.
  const matches = records.filter(p => [number, number.slice(0, 13)].includes(digits(p.numero)));
  if (matches.length !== 1 || records.length !== 1) throw new SourceError('O Projudi não retornou um processo único correspondente ao número solicitado.');
  const p = matches[0];
  const secrecy = text(p.outrasInformacoes?.segredoJustica).toLocaleLowerCase('pt-BR');
  if (['true','1','sim','s'].includes(secrecy)) throw new SourceError('O Projudi informou que o processo não permite consulta pública.', false);
  if (!['false', '0', 'não', 'nao', 'n'].includes(secrecy)) throw new SourceError('O Projudi não confirmou que o processo permite consulta pública.');
  const id = text(p.idProcesso), hash = text(p.hashProcesso);
  if (!/^\d{1,30}$/.test(id) || !hash || hash.length > 256 || /[\u0000-\u001f\u007f]/.test(hash)) throw new SourceError('Identificadores inválidos na consulta Projudi.');
  return { id, hash };
}

function movementDate(value) {
  const s = text(value);
  const local = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}T${local[4]}:${local[5]}:${local[6]}-03:00` : s;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso) || !Number.isFinite(Date.parse(iso))) throw new SourceError('Data de movimentação inválida no Projudi.');
  const date = new Date(iso);
  const calendar = local && new Date(date.getTime() - 3 * 3600000).toISOString();
  if (calendar && calendar.slice(0, 19) !== iso.slice(0, 19)) throw new SourceError('Data de movimentação inválida no Projudi.');
  return date.toISOString();
}

export function parseGoMovements(xml, processId) {
  const root = response(xml, '75');
  if (root.situacao !== 'OK' || !root.mensagem || root.mensagem.lista == null) throw new SourceError('O Projudi não retornou um histórico público válido.');
  // Never commit a partial baseline when the service indicates unhandled pagination.
  if (root.mensagem.paginacao != null && root.mensagem.paginacao !== '') throw new SourceError('Histórico paginado do Projudi ainda não confirmado; nenhuma movimentação foi salva.');
  if (root.mensagem.lista !== '' && !Object.hasOwn(root.mensagem.lista, 'Movimentacao')) throw new SourceError('Lista de movimentações fora do contrato Projudi.');
  return list(root.mensagem.lista.Movimentacao).map(m => {
    const id = text(m.IdMovimentacao);
    const description = [text(m.DescricaoMovimentacao), text(m.Complemento)].filter(Boolean).join(' · ');
    if (!id || !description) throw new SourceError('Movimentação incompleta na resposta Projudi.');
    const date = movementDate(m.DataRealizacao);
    return { key: JSON.stringify(['tjgo', processId, id, date, description]), date, description: description.slice(0, 4000) };
  });
}
