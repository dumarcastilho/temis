export interface NamedCode { code: string; name: string }
export interface CaseInformation {
  caseClass?: NamedCode;
  subjects?: NamedCode[];
  courtUnit?: NamedCode;
  filedAt?: string;
  system?: string;
  format?: string;
}
export const infoText = (value: unknown, limit = 240): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g,' ').trim().slice(0, limit) : '';
export function filedDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const input = value.trim();
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(input);
  const s = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : /^\d{14}$/.test(input) ? `${input.slice(0,4)}-${input.slice(4,6)}-${input.slice(6,8)}` : input.slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const time = Date.parse(s+'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === s ? s : undefined;
}
export function namedCode(value: any): NamedCode | undefined {
  const code = String(value?.codigo ?? '');
  const name = infoText(typeof value === 'string' ? value : value?.nome || value?.descricao);
  return /^\d+$/.test(code) || name ? { code: /^\d+$/.test(code) ? code : '', name } : undefined;
}
