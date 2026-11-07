import { maskCnj } from './cnj-mask.js';

export function courtProcessLink(process, court) {
  const number = process.number.replace(/\D/g, '');
  if (!/^\d{20}$/.test(number)) throw new Error('Número CNJ inválido.');
  if (process.tribunal === 'tjmt') return { url: `https://consultaprocessual.tjmt.jus.br/consulta-retorno?numeroUnico=${number}`, detail: true, help: '' };
  const url = new URL(court.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.jus.br')) throw new Error('Endereço do tribunal inválido.');
  if (process.tribunal === 'tjgo') url.searchParams.set('ProcessoNumero', maskCnj(number));
  else if (/\/ConsultaPublica\/listView\.seam$/.test(url.pathname)) url.searchParams.set('numeroProcesso', maskCnj(number));
  return { url: url.href, detail: false, help: 'O tribunal pode exigir pesquisa ou CAPTCHA antes de abrir o detalhe. Ao abrir, tentaremos copiar o número para facilitar a consulta.' };
}
