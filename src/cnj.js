// Dumar Castilho - https://github.com/dumarcastilho
import { courtCatalog } from './court-catalog.js';
export function normalizeNumber(value) {
  if (typeof value !== 'string' || !/^[\d.\-\s]+$/.test(value)) throw new Error('Informe um número CNJ válido.');
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 20) throw new Error('O número CNJ deve ter 20 dígitos.');
  const base = digits.slice(0, 7) + digits.slice(9) + '00';
  let remainder = 0;
  for (const digit of base) remainder = (remainder * 10 + Number(digit)) % 97;
  if (String(98 - remainder).padStart(2, '0') !== digits.slice(7, 9)) throw new Error('Dígito verificador do número CNJ inválido.');
  return digits;
}

export function formatNumber(n) {
  return n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
}

export function tribunalFor(n) {
  const court = courtCatalog.find(c => c.cnjBranch === n[13] && c.cnjCode === n.slice(14, 16));
  if (court) return court.id;
  throw new Error('Este segmento ou tribunal ainda não é suportado.');
}
