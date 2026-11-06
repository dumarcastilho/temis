// Dumar Castilho - https://github.com/dumarcastilho
import type { Env, ProcessRow } from './env';
import { authenticate } from './auth';
import { courts, connectors } from './courts';
import { normalizeNumber, tribunalFor } from './cnj.js';
import { checkProcess, monitor } from './monitor';

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400): never => { throw json({ error: message }, status); };
const textField = (value: unknown, max: number) => {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) return fail(`Campo de texto inválido (máximo ${max} caracteres).`);
  return value.trim();
};
async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('Envie JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) return fail('Corpo da requisição ausente.');
  let size = 0;
  const decoder = new TextDecoder();
  let body = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); return fail('Dados excedem o limite.', 413); }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try { const data = JSON.parse(body); if (!data || Array.isArray(data) || typeof data !== 'object') return fail('JSON inválido.'); return data; }
  catch { return fail('JSON inválido.'); }
}

async function api(request: Request, env: Env, email: string) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/session') {
    const configured = connectors(env);
    return json({ email, courts: courts.map(c => ({ ...c, instances: ['1g', '2g'].map(instance => ({ instance, configured: c.id === 'tjmt' || !!configured[`${c.id}:${instance}`] })) })) });
  }
  if (request.method === 'GET' && path === '/api/processes') {
    const rows = await env.DB.prepare(`SELECT p.*, (SELECT description FROM movements WHERE process_id=p.id ORDER BY occurred_at DESC LIMIT 1) latest_movement, (SELECT occurred_at FROM movements WHERE process_id=p.id ORDER BY occurred_at DESC LIMIT 1) latest_movement_at, (SELECT count(*) FROM notifications n WHERE n.process_id=p.id AND NOT EXISTS(SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_email=?)) unread FROM processes p ORDER BY p.created_at DESC`).bind(email).all();
    return json(rows.results.map(({ lease_token, lease_until, created_by, ...p }) => p));
  }
  if (request.method === 'POST' && path === '/api/processes') {
    const body = await readBody(request);
    let number: string;
    let tribunal: string;
    try { number = normalizeNumber(body.number); tribunal = tribunalFor(number); }
    catch (e) { return fail(e instanceof Error ? e.message : 'Número inválido.'); }
    if (!courts.some(c => c.id === tribunal)) return fail('Tribunal ainda não disponível no cadastro.');
    const instance = body.instance || '1g';
    if (!['1g','2g'].includes(instance)) return fail('Instância inválida.');
    const id = crypto.randomUUID();
    const label = textField(body.label, 120), notes = textField(body.notes, 4000);
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO processes(id,number,tribunal,instance,label,notes,created_by) VALUES (?,?,?,?,?,?,?)`).bind(id, number, tribunal, instance, label, notes, email).run();
    if (!result.meta.changes) return fail('Este processo já está cadastrado nesta instância.', 409);
    return json({ id }, 201);
  }
  const match = path.match(/^\/api\/processes\/([a-f0-9-]{36})(?:\/(movements|check))?$/);
  if (match) {
    const [, id, action] = match;
    const process = await env.DB.prepare('SELECT * FROM processes WHERE id=?').bind(id).first<ProcessRow>();
    if (!process) return fail('Processo não encontrado.', 404);
    if (request.method === 'GET' && action === 'movements') {
      const page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0));
      const results = await env.DB.prepare('SELECT id,occurred_at,description,detected_at FROM movements WHERE process_id=? ORDER BY occurred_at DESC,id LIMIT 101 OFFSET ?').bind(id, Math.floor(page) * 100).all();
      return json({ items: results.results.slice(0,100), hasMore: results.results.length > 100 });
    }
    if (request.method === 'POST' && action === 'check') {
      if (!process.active) return fail('Retome o acompanhamento antes de consultar.');
      const result = await checkProcess(env, id, true);
      return json(result, result.status === 'error' ? 502 : result.status === 'skipped' ? 429 : 200);
    }
    if (request.method === 'PATCH' && !action) {
      const body = await readBody(request);
      if (body.active !== undefined && typeof body.active !== 'boolean') return fail('Estado inválido.');
      const label = body.label === undefined ? process.label : textField(body.label, 120);
      const notes = body.notes === undefined ? process.notes : textField(body.notes, 4000);
      await env.DB.prepare('UPDATE processes SET label=?,notes=?,active=? WHERE id=?').bind(label, notes, body.active === undefined ? process.active : body.active ? 1 : 0, id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE' && !action) {
      await env.DB.prepare('DELETE FROM processes WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }
  if (request.method === 'GET' && path === '/api/notifications') {
    const page = Math.max(0, Math.min(10000, Math.floor(Number(url.searchParams.get('page')) || 0)));
    const rows = await env.DB.prepare(`SELECT n.id,n.process_id,n.created_at,p.number,p.label,p.tribunal,m.description,m.occurred_at,CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read FROM notifications n JOIN processes p ON p.id=n.process_id JOIN movements m ON m.id=n.movement_id LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_email=? ORDER BY n.created_at DESC,n.id LIMIT 101 OFFSET ?`).bind(email, page * 100).all();
    return json({ items: rows.results.slice(0,100), hasMore: rows.results.length > 100 });
  }
  const read = path.match(/^\/api\/notifications\/([a-f0-9-]{36})\/read$/);
  if (request.method === 'POST' && read) {
    await env.DB.prepare('INSERT OR IGNORE INTO notification_reads(notification_id,user_email) SELECT id,? FROM notifications WHERE id=?').bind(email, read[1]).run();
    return json({ ok: true });
  }
  return fail('Rota não encontrada.', 404);
}

function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const email = await authenticate(request, env);
      const url = new URL(request.url);
      if (!['GET','HEAD'].includes(request.method)) {
        const origin = request.headers.get('Origin');
        const expected = env.APP_ORIGIN || url.origin;
        if (!origin || origin !== expected || url.origin !== expected) return secure(json({ error: 'Origem da requisição não autorizada.' }, 403));
      }
      if (url.pathname.startsWith('/api/')) return secure(await api(request, env, email));
      if (!['GET','HEAD'].includes(request.method)) return secure(json({ error: 'Método não permitido.' }, 405));
      return secure(await env.ASSETS.fetch(request));
    } catch (error) {
      if (error instanceof Response) return secure(error);
      return secure(json({ error: 'Não foi possível concluir a operação.' }, 500));
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(monitor(env)); },
} satisfies ExportedHandler<Env>;
