import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

const bundle=await build({entryPoints:['src/auth.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'node24'});
const {authenticate}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const env={ACCESS_AUD:'synthetic-audience',ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com'};
const request=(token, url='https://temis.example.invalid/')=>new Request(url,{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
test('production fails closed and refuses header identity or remote local-dev bypass', async()=>{
  await assert.rejects(authenticate(request(),{}),e=>e.status===503);
  await assert.rejects(authenticate(new Request('https://temis.example.invalid/',{headers:{'Cf-Access-Authenticated-User-Email':'user@example.invalid'}}),env),e=>e.status===401);
  await assert.rejects(authenticate(request(),{...env,LOCAL_DEV:'true'}),e=>e.status===401);
  assert.equal(await authenticate(request(null,'http://localhost:8787/'),{LOCAL_DEV:'true'}),'developer@example.invalid');
});
test('Access validates signature, issuer, audience and expiration', async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({keys:[jwk]});
  const sign=async (aud=env.ACCESS_AUD,iss='https://'+env.ACCESS_TEAM_DOMAIN,expiry='1h',key=privateKey)=>new SignJWT({email:'User@example.invalid'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(key);
  try{
    assert.equal(await authenticate(request(await sign()),env),'user@example.invalid');
    for(const token of [await sign('other-audience'),await sign(env.ACCESS_AUD,'https://wrong.example.invalid'),await sign(env.ACCESS_AUD,'https://'+env.ACCESS_TEAM_DOMAIN,'-1h'),'invalid.jwt.value']) await assert.rejects(authenticate(request(token),env),e=>e.status===401);
    const attacker=await generateKeyPair('RS256');
    await assert.rejects(authenticate(request(await sign(env.ACCESS_AUD,'https://'+env.ACCESS_TEAM_DOMAIN,'1h',attacker.privateKey)),env),e=>e.status===401);
  }finally{globalThis.fetch=original;}
});
