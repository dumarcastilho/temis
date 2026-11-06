import { maskCnj } from './cnj-mask.js';

export const processState = process => process.tribunal === 'tjdft' ? 'DF' : process.tribunal.replace(/^tj/, '').toUpperCase();
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const localityConnectors = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function formatLocality(value = '') {
  return value.trim().toLocaleLowerCase('pt-BR').replace(/\p{L}[\p{L}\p{M}]*/gu, (word, offset) =>
    offset > 0 && localityConnectors.has(word) ? word : word[0].toLocaleUpperCase('pt-BR') + word.slice(1));
}

export function sortProcessList(processes) {
  return [...processes].sort((a, b) =>
    collator.compare(processState(a), processState(b)) ||
    collator.compare(a.locality || '', b.locality || '') ||
    collator.compare(a.number, b.number) || collator.compare(a.instance, b.instance));
}

export function processTrackingStatus(process, configured = true) {
  if (!process.active) return ['paused', 'Pausado', 3];
  if (process.last_error) return ['error', 'Precisa de atenção', 0];
  if (!configured) return ['error', 'Integração pendente', 0];
  if (!process.initialized) return ['paused', 'Primeira consulta pendente', 1];
  return ['ok', 'Em acompanhamento', 2];
}

export function sortTrackingProcesses(processes, isConfigured) {
  return [...processes].sort((a, b) =>
    processTrackingStatus(a, !!isConfigured(a))[2] - processTrackingStatus(b, !!isConfigured(b))[2]);
}

export function processListText(processes) {
  return sortProcessList(processes).map(p => [
    processState(p),
    formatLocality(p.locality) || 'Comarca não informada',
    maskCnj(p.number),
    ...(p.instance === '2g' ? ['2º grau'] : []),
  ].join('\n')).join('\n\n');
}
