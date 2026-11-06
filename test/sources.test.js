import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/sources.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24' });
const { queryTjmt, querySource } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const number = '99999990020998119999';

test('TJMT uses Workers-compatible manual redirects and reads the returned history', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    calls.push(String(url));
    return Response.json(calls.length === 1
      ? { itens: [{ numeroUnico: number, idInstancia: 1, codigoProcessoStr: '999' }], totalRegistros: 1 }
      : { numeroUnico: number, segredo: false, eventos: [{ idProcessoEvento: 1, data: '2099-01-01T12:00:00-04:00', descricao: 'Movimento sintético', sigilo: false }] });
  };
  try { assert.equal((await queryTjmt(number, '1g')).length, 1); assert.equal(calls.length, 2); }
  finally { globalThis.fetch = original; }
});

test('TJMT and MNI reject redirects without following them or sending credentials to another host', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'manual'); calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://other.example.invalid/' } });
  };
  try {
    await assert.rejects(queryTjmt(number, '1g'), /redirecionou/);
    const process = { number, tribunal: 'tjpe', instance: '1g' };
    // Official endpoint shape; global fetch is mocked, so no tribunal receives this test request.
    const env = { COURT_CONNECTORS: JSON.stringify({ 'tjpe:1g': { endpoint: 'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2', username: 'synthetic', password: 'synthetic' } }) };
    await assert.rejects(querySource(process, env), /redirecionou/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('the default TJPE first-instance connector parses multipart SOAP with synthetic movements', async () => {
  const original = globalThis.fetch;
  const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><consultarProcessoResposta><sucesso>true</sucesso><processo><dadosBasicos numero="${number}"/><movimento dataHora="20990101120000"><movimentoLocal codigoMovimento="9" descricao="Movimento sintético"/></movimento></processo></consultarProcessoResposta></s:Body></s:Envelope>`;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
    assert.ok(!options.body.includes('senhaConsultante'));
    return new Response(`--synthetic\r\nContent-Type: application/xop+xml\r\nContent-ID: <root>\r\n\r\n${xml}\r\n--synthetic--\r\n`, { headers: { 'Content-Type': 'multipart/related; boundary=synthetic; start="<root>"' } });
  };
  try {
    const movements = await querySource({ number, tribunal: 'tjpe', instance: '1g' }, {});
    assert.equal(movements.length, 1); assert.equal(movements[0].description, 'Movimento sintético');
    assert.equal(movements[0].date, '2099-01-01T15:00:00.000Z');
  } finally { globalThis.fetch = original; }
});
