import type { Env, ProcessRow } from './env';
import { queryDatajud, datajudEnabled } from './datajud';
import { queryDjen, InformationRateLimit } from './djen';
import { SourceError } from './mni.js';
import type { CaseInformation } from './information-types';

interface InformationRow {
  provider: 'direct'|'datajud'|'djen'; data_json: string; checked_at: string|null;
  source_updated_at: string|null; last_error: string|null; next_check_at: number;
  lease_until: number; lease_token: string|null;
}
function publicRow(row: InformationRow) {
  let data: unknown = {};
  try { data = JSON.parse(row.data_json); } catch {}
  return {provider:row.provider,data,checkedAt:row.checked_at,updatedAt:row.source_updated_at,error:row.last_error,stale:row.next_check_at<=Date.now(),busy:row.lease_until>Date.now()};
}
export async function getInformation(env: Env, id: string) {
  const result=await env.DB.prepare('SELECT * FROM process_information WHERE process_id=?').bind(id).all<InformationRow>();
  return result.results.map(publicRow);
}
export async function storeCaseInformation(env: Env, id: string, source: 'direct'|'datajud', information: CaseInformation, updatedAt: string|null, processLease: string) {
  if (!information.caseClass && !information.courtUnit && !information.filedAt && !information.subjects?.length && !information.system && !information.format) return;
  const data=JSON.stringify(information);
  if (new TextEncoder().encode(data).byteLength>100000) return;
  await env.DB.prepare(`INSERT INTO process_information(process_id,provider,data_json,checked_at,source_updated_at,next_check_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM processes WHERE id=? AND lease_token=?)
    ON CONFLICT(process_id,provider) DO UPDATE SET data_json=excluded.data_json,checked_at=excluded.checked_at,source_updated_at=excluded.source_updated_at,last_error=NULL,next_check_at=excluded.next_check_at
    WHERE process_information.source_updated_at IS NULL OR excluded.source_updated_at IS NULL OR excluded.source_updated_at>=process_information.source_updated_at`)
    .bind(id,source,data,new Date().toISOString(),updatedAt,Date.now()+6*3600000,id,processLease).run();
}
export async function refreshInformation(env: Env, process: ProcessRow, provider: 'datajud'|'djen', manual=false) {
  if (provider==='datajud'&&!datajudEnabled(env)) throw new SourceError('Consulta complementar ao DataJud desativada.');
  const now=Date.now(),token=crypto.randomUUID();
  await env.DB.prepare('INSERT OR IGNORE INTO process_information(process_id,provider) VALUES (?,?)').bind(process.id,provider).run();
  const claimed=await env.DB.prepare(`UPDATE process_information SET lease_token=?,lease_until=?,last_attempt_at=? WHERE process_id=? AND provider=? AND lease_until<? AND
    ((?=0 AND next_check_at<=?) OR (?=1 AND last_attempt_at<? AND (last_error IS NULL OR next_check_at<=?))) RETURNING *`)
    .bind(token,now+180000,now,process.id,provider,now,manual?1:0,now,manual?1:0,now-60000,now).first<InformationRow>();
  if (!claimed) {
    const row=await env.DB.prepare('SELECT * FROM process_information WHERE process_id=? AND provider=?').bind(process.id,provider).first<InformationRow>();
    return {status:'cached',information:row?publicRow(row):null};
  }
  try {
    let data: unknown, updatedAt: string|null=null;
    if (provider==='datajud') {const result=await queryDatajud(process,env,false);data=result.information;updatedAt=result.updatedAt;}
    else {data=await queryDjen(process);}
    const serialized=JSON.stringify(data);
    if (new TextEncoder().encode(serialized).byteLength>600000) throw new SourceError('As informações excederam o limite de armazenamento.');
    await env.DB.prepare(`UPDATE process_information SET data_json=CASE WHEN provider='datajud' AND COALESCE(source_updated_at,'')>COALESCE(?,'') THEN data_json ELSE ? END,
      source_updated_at=CASE WHEN provider='datajud' AND COALESCE(source_updated_at,'')>COALESCE(?,'') THEN source_updated_at ELSE ? END,
      checked_at=?,last_error=NULL,next_check_at=?,lease_token=NULL,lease_until=0 WHERE process_id=? AND provider=? AND lease_token=?`)
      .bind(updatedAt,serialized,updatedAt,updatedAt,new Date().toISOString(),now+6*3600000,process.id,provider,token).run();
  } catch(error) {
    const message=error instanceof SourceError?error.message:'Não foi possível consultar esta fonte complementar. Tente novamente mais tarde.';
    const delay=error instanceof InformationRateLimit?error.retrySeconds*1000:10*60000;
    await env.DB.prepare('UPDATE process_information SET last_error=?,next_check_at=?,lease_token=NULL,lease_until=0 WHERE process_id=? AND provider=? AND lease_token=?')
      .bind(message,now+delay,process.id,provider,token).run();
  }
  const row=await env.DB.prepare('SELECT * FROM process_information WHERE process_id=? AND provider=?').bind(process.id,provider).first<InformationRow>();
  return {status:row?.last_error?'error':'ok',information:row?publicRow(row):null};
}
