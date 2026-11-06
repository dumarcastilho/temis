import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMni, envelope, soapXml } from '../src/mni.js';

const number = '99999990020998119999';
const xml = (movements='',success='true',n=number) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><r:consultarProcessoResposta xmlns:r="urn:test"><sucesso>${success}</sucesso><processo><dadosBasicos numero="${n}"/>${movements}</processo></r:consultarProcessoResposta></s:Body></s:Envelope>`;
test('parses namespaced MNI, local descriptions, leading zeros and local dates', () => {
  const moves = parseMni(xml('<movimento dataHora="20990101120000" identificadorMovimento="0001"><complemento>Exemplo sintético</complemento><movimentoLocal codigoMovimento="9" descricao="Juntada"/></movimento>'),number,'-04:00');
  assert.equal(moves.length,1); assert.equal(moves[0].date,'2099-01-01T16:00:00.000Z');
  assert.equal(moves[0].description,'Juntada · Exemplo sintético');
  assert.ok(moves[0].key.includes('0001'));
});
test('empty successful history is valid; failure and wrong process are not',()=> {
  assert.deepEqual(parseMni(xml(),number),[]);
  assert.throws(()=>parseMni(xml('','false'),number));
  assert.throws(()=>parseMni(xml('','true','111'),number));
  assert.throws(()=>parseMni('<html>Captcha</html>',number));
  assert.throws(()=>parseMni('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml(),number));
});
test('national code fallback and movement secrecy',()=> {
  const movement='<movimento dataHora="20990101120000"><movimentoNacional codigoNacional="51"/></movimento>';
  assert.equal(parseMni(xml(movement),number)[0].description,'Movimento 51');
  assert.deepEqual(parseMni(xml(movement.replace('dataHora=','nivelSigilo="1" dataHora=')),number),[]);
});
test('envelope escapes credentials and requests header without document contents',()=> {
  const body=envelope(number,{username:'u<&',password:'p"<'});
  assert.ok(body.includes('u&lt;&amp;'));assert.ok(body.includes('p&quot;&lt;'));
  assert.ok(body.includes('<tip:movimentos>true</tip:movimentos>'));
  assert.ok(!body.includes('incluirDocumentos'));
});

test('reads the XML root from an MTOM multipart response without treating MIME headers as XML', () => {
  const boundary = 'synthetic.+boundary';
  const body = `--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-ID: <attachment>\r\n\r\nIgnored attachment\r\n--${boundary}\r\nContent-Type: application/xop+xml; charset=UTF-8; type="text/xml"\r\nContent-Transfer-Encoding: binary\r\nContent-ID: <soap-root>\r\n\r\n${xml()}\r\n--${boundary}--\r\n`;
  const contentType = `multipart/related; boundary="${boundary}"; start="<soap-root>"; type="application/xop+xml"`;
  assert.equal(soapXml(body, contentType), xml());
  assert.deepEqual(parseMni(soapXml(body, contentType), number), []);
  assert.equal(soapXml(xml(), 'text/xml'), xml());
});

test('supports a base64 XML root and refuses missing, incomplete or unsupported MIME parts', () => {
  const contentType = 'multipart/related; boundary=synthetic';
  const body = `--synthetic\nContent-Type: text/xml\nContent-Transfer-Encoding: base64\n\n${Buffer.from(xml()).toString('base64')}\n--synthetic--\n`;
  assert.equal(soapXml(body, contentType), xml());
  assert.throws(() => soapXml(body, 'multipart/related'), /delimitador/);
  assert.throws(() => soapXml(body.replace('--synthetic--', ''), contentType), /incompleta/);
  assert.throws(() => soapXml(body, contentType + '; start="<missing>"'), /ausente/);
  assert.throws(() => soapXml(body.replace('Content-Type: text/xml', 'Content-Type: application/octet-stream'), contentType), /não contém XML/);
  assert.throws(() => soapXml(body.replace('base64', 'quoted-printable'), contentType), /não suportada/);
});
