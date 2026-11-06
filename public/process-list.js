import { maskCnj } from './cnj-mask.js';

export const processState = process => process.tribunal.replace(/^tj/, '').toUpperCase();
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
export function sortProcessList(processes) {
  return [...processes].sort((a, b) =>
    collator.compare(processState(a), processState(b)) ||
    collator.compare(a.locality || '', b.locality || '') ||
    collator.compare(a.number, b.number) || collator.compare(a.instance, b.instance));
}

export function processListText(processes) {
  return sortProcessList(processes).map(p => [
    processState(p),
    p.locality || 'Comarca não informada',
    maskCnj(p.number),
    ...(p.instance === '2g' ? ['2º grau'] : []),
  ].join('\n')).join('\n\n');
}
