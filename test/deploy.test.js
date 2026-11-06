import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploymentConfig, deploy } from '../scripts/deploy.mjs';

const base = { main: 'src/index.ts', workers_dev: false, preview_urls: false, d1_databases: [{ binding: 'DB', database_name: 'temis', database_id: '00000000-0000-0000-0000-000000000000' }], vars: { ACCESS_AUD: '', ACCESS_TEAM_DOMAIN: '', APP_ORIGIN: '', CHECK_INTERVAL_MINUTES: '120' } };
const env = { TEMIS_D1_DATABASE_ID: '11111111-2222-4333-8444-555555555555', APP_ORIGIN: 'https://temis.example.com', ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'synthetic-audience', LOCAL_DEV: 'true', UNRELATED_SECRET: 'synthetic-secret' };

test('deployment uses build configuration without exposing unrelated environment values or changing source', () => {
  const config = deploymentConfig(base, env);
  assert.equal(config.d1_databases[0].database_id, env.TEMIS_D1_DATABASE_ID);
  assert.equal(base.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000000');
  assert.equal(config.vars.APP_ORIGIN, env.APP_ORIGIN);
  assert.equal(config.keep_vars, true);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars.LOCAL_DEV, undefined);
  assert.equal(config.vars.UNRELATED_SECRET, undefined);
  assert.deepEqual(deploymentConfig(base, { TEMIS_D1_DATABASE_ID: env.TEMIS_D1_DATABASE_ID }).vars, { CHECK_INTERVAL_MINUTES: '120' });
});
test('invalid D1 and Access settings fail before contacting Cloudflare', () => {
  for (const id of [undefined, 'invalid', base.d1_databases[0].database_id]) assert.throws(() => deploymentConfig(base, { TEMIS_D1_DATABASE_ID: id }), /TEMIS_D1_DATABASE_ID/);
  assert.throws(() => deploymentConfig(base, { ...env, APP_ORIGIN: 'http://example.com' }), /HTTPS/);
  assert.throws(() => deploymentConfig(base, { ...env, ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com' }), /ACCESS_TEAM_DOMAIN/);
});
test('deployment applies migrations before publishing and removes generated configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'temis-deploy-test-'));
  const original = JSON.stringify(base);
  try {
    await writeFile(join(root, 'wrangler.jsonc'), original);
    const calls = [];
    await deploy({ root, env, run: async args => {
      calls.push(args);
      const generated = JSON.parse(await readFile(join(root, 'wrangler.build.jsonc'), 'utf8'));
      assert.equal(generated.d1_databases[0].database_id, env.TEMIS_D1_DATABASE_ID);
    } });
    assert.deepEqual(calls.map(c => c[0]), ['d1', 'deploy']);
    assert.ok(calls[0].includes('--remote'));
    assert.equal(await readFile(join(root, 'wrangler.jsonc'), 'utf8'), original);
    await assert.rejects(access(join(root, 'wrangler.build.jsonc')));
    const failed = [];
    await assert.rejects(deploy({ root, env, run: async args => { failed.push(args); throw new Error('Migration failure'); } }), /Migration failure/);
    assert.equal(failed.length, 1);
    await assert.rejects(access(join(root, 'wrangler.build.jsonc')));
    const dry = [];
    await deploy({ root, env, dryRun: true, run: async args => dry.push(args) });
    assert.equal(dry.length, 1); assert.ok(dry[0].includes('--dry-run'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
