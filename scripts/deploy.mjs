// Dumar Castilho - https://github.com/dumarcastilho
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export function deploymentConfig(base, env) {
  const id = env.TEMIS_D1_DATABASE_ID?.trim();
  if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) {
    throw new Error('Defina TEMIS_D1_DATABASE_ID nas variáveis de build com o UUID real do banco D1 temis. Crie o banco em Storage & databases > D1 antes de implantar.');
  }
  const config = structuredClone(base);
  const db = config.d1_databases?.find(binding => binding.binding === 'DB');
  if (!db) throw new Error('Binding D1 DB não encontrado na configuração.');
  db.database_id = id;
  // Preserve runtime values managed in the Cloudflare dashboard when builds do not supply them.
  config.keep_vars = true;
  config.vars = Object.fromEntries(Object.entries(config.vars || {}).filter(([key, value]) => key !== 'LOCAL_DEV' && value !== ''));
  for (const key of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'APP_ORIGIN', 'CHECK_INTERVAL_MINUTES', 'DATAJUD_ENABLED']) {
    if (env[key]?.trim()) config.vars[key] = env[key].trim();
  }
  if (config.vars.ACCESS_TEAM_DOMAIN && !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.vars.ACCESS_TEAM_DOMAIN)) {
    throw new Error('ACCESS_TEAM_DOMAIN deve ter o formato sua-equipe.cloudflareaccess.com, sem https:// ou caminhos.');
  }
  if (config.vars.APP_ORIGIN) {
    const url = new URL(config.vars.APP_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== config.vars.APP_ORIGIN) throw new Error('APP_ORIGIN deve ser uma origem HTTPS, sem caminho ou barra final.');
  }
  return config;
}

export async function deploy({ root = fileURLToPath(new URL('../', import.meta.url)), env = process.env, dryRun = false, run } = {}) {
  const base = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const config = deploymentConfig(base, env);
  const configPath = resolve(root, 'wrangler.build.jsonc');
  const execute = run || (args => {
    const cli = resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin/wrangler.js');
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', env: { ...env, CI: 'true' } });
    if (result.error) throw new Error(`Não foi possível iniciar Wrangler: ${result.error.message}`);
    if (result.status !== 0) throw new Error('Wrangler não concluiu a operação. Confira a mensagem acima.');
  });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    if (!dryRun) await execute(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]);
    await execute(['deploy', '--config', configPath, ...(dryRun ? ['--dry-run', '--outdir', 'dist'] : [])]);
  } finally {
    await unlink(configPath);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  deploy({ dryRun: process.argv.includes('--dry-run') }).catch(error => {
    console.error(`Temis: ${error.message}`);
    process.exitCode = 1;
  });
}
