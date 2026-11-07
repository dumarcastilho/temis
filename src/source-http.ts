import { SourceError } from './mni.js';

export async function boundedResponse(response: Response): Promise<string> {
  if (response.status >= 300 && response.status < 400) throw new SourceError('O tribunal redirecionou a consulta. O histórico não foi alterado; verifique a disponibilidade do serviço.');
  if (response.status === 401 || response.status === 403) throw new SourceError(`O tribunal recusou o acesso ao serviço (HTTP ${response.status}). Confirme as permissões, as credenciais quando exigidas e eventuais exigências de liberação de acesso com o tribunal.`);
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
  const declaration = new TextDecoder().decode(joined.subarray(0, 200));
  const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
    || declaration.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i)?.[1] || 'utf-8';
  if (!/^(?:utf-8|utf8|iso-8859-1|windows-1252)$/i.test(charset)) throw new SourceError('Codificação de texto do tribunal não suportada.');
  return new TextDecoder(charset).decode(joined);
}

