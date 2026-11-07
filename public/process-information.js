const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const shortDate = value => { const d=new Date(String(value).slice(0,10)+'T12:00:00Z'); return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'UTC'}).format(d):'Não informada'; };
const checkedDate = value => value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value)):'Ainda não consultada';
const named = value => value?.name || (value?.code ? `Código ${value.code}` : 'Não informado');
function sourceStatus(row) {
  return `<p class="field-help">Consultado em ${esc(checkedDate(row.checkedAt))}${row.updatedAt?` · Atualização da base: ${esc(checkedDate(row.updatedAt))}`:''}</p>${row.error?`<p class="alert">${esc(row.error)}${row.checkedAt?' Os dados anteriores foram preservados.':''}</p>`:''}`;
}
function officialLinkHtml(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.jus.br')||url.username||url.password||url.port)return '';
    return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Ver documento oficial ↗</a>`;
  }catch{return '';}
}
export function informationHtml(sources) {
  return ['direct','datajud'].map(provider=>{
    const row=sources[provider];if(!row)return provider==='datajud'?'<p class="field-help">Os dados complementares do CNJ serão consultados nesta aba.</p>':'';
    const data=row.data||{};
    const fields=[['Classe processual',named(data.caseClass)],['Órgão julgador',named(data.courtUnit)],['Ajuizamento',data.filedAt?shortDate(data.filedAt):'Não informado'],['Sistema',data.system||'Não informado'],['Formato',data.format||'Não informado']];
    return `<article class="information-card"><h3>${provider==='direct'?'Dados do tribunal':'Dados do DataJud / CNJ'}</h3>${sourceStatus(row)}${row.checkedAt?`<dl class="information-fields">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><h4>Assuntos</h4>${data.subjects?.length?`<ul>${data.subjects.map(s=>`<li>${esc(named(s))}</li>`).join('')}</ul>`:'<p class="field-help">Assuntos não informados por esta fonte.</p>'}`:''}</article>`;
  }).join('');
}
export function publicationsHtml(row) {
  if(!row)return '<p class="field-help">As publicações do DJEN serão consultadas nesta aba.</p>';
  const data=row.data||{},items=data.publications||[];
  return `${sourceStatus(row)}${row.checkedAt?`<p class="field-help">Publicações de ${esc(shortDate(data.since))} a ${esc(shortDate(data.until))}. ${items.length} exibida(s) de ${Number(data.total)||0} encontrada(s).${data.limited?' A exibição foi limitada.':''} Publicações complementam os movimentos; não representam todo o andamento do processo.</p>${items.length?items.map(item=>`<details class="publication-card"><summary><span>${esc(shortDate(item.publishedOn))} · ${esc(item.type)}${item.active?'':' · Cancelada / inativa'}</span><small>${esc(item.courtUnit)}</small></summary>${item.recipients?.length?`<p><strong>Destinatários:</strong> ${esc(item.recipients.join('; '))}</p>`:''}${item.lawyers?.length?`<p><strong>Advogados:</strong> ${esc(item.lawyers.join('; '))}</p>`:''}<p class="publication-text">${esc(item.text)}</p>${item.truncated?'<p class="field-help">Texto resumido para exibição. Consulte o documento oficial para ler o conteúdo completo.</p>':''}${officialLinkHtml(item.link)}</details>`).join(''):'<p>Nenhuma publicação encontrada no período consultado.</p>'}`:''}`;
}
