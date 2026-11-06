import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env';

const verifiers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticate(request: Request, env: Env): Promise<string> {
  const url = new URL(request.url);
  // Development access is confined to loopback; never enable LOCAL_DEV remotely.
  if (env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'developer@example.invalid';
  if (!env.ACCESS_AUD || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)) {
    throw new Response('Cloudflare Access precisa ser configurado.', { status: 503 });
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Response('Autenticação necessária.', { status: 401 });
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let keys = verifiers.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    verifiers.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    if (typeof payload.email !== 'string' || !payload.email.includes('@')) throw new Error('Missing identity');
    return payload.email.toLowerCase();
  } catch {
    throw new Response('Sessão inválida ou expirada.', { status: 401 });
  }
}
