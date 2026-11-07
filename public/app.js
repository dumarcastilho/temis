import { bindCnjMask } from './cnj-mask.js';
import { courtProcessLink } from './court-link.js';
import { processState, sortProcessList, processListText, formatLocality, processTrackingStatus, sortTrackingProcesses } from './process-list.js';
const $ = selector => document.querySelector(selector);
const state = { processes: [], visibleProcesses: [], session: null, selected: null, page: 0, notificationPage: 0, view: 'processes', processView: 'tracking' };
try { if (localStorage.getItem('temis.processView') === 'simple') state.processView = 'simple'; } catch {}
const format = n => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
const sourceName = p => p.last_source === 'datajud' ? 'DataJud' : 'Tribunal';
const sourceNote = p => p.last_source === 'datajud' ? `DataJud · atualização da base: ${p.source_updated_at ? date(p.source_updated_at) : 'não informada'}` : 'Consulta direta';
const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : 'Ainda não consultado';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function error(message) { $('#global-error').textContent = message; $('#global-error').hidden = !message; }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : {'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error(response.status === 401 ? 'Sua sessão expirou. Recarregue a página para entrar.' : 'Não foi possível acessar o Temis. Verifique sua sessão.'); }
  if (!response.ok) throw new Error(result.error || result.message || (response.status === 429 ? 'Consulta já em andamento ou realizada há menos de um minuto.' : 'Não foi possível concluir a operação.'));
  return result;
}
async function busy(button, task) { button.disabled = true; try { return await task(); } finally { button.disabled = false; } }
function configured(p) { return state.session?.courts.find(c => c.id === p.tribunal)?.instances.find(i => i.instance === p.instance)?.configured; }
function status(p) { return processTrackingStatus(p, !!configured(p)); }
function render() {
  const simple = state.processView === 'simple';
  const query = $('#search').value.toLowerCase().trim(), court = $('#court-filter').value, filter = simple ? '' : $('#status-filter').value;
  const filtered = state.processes.filter(p => (!query || `${p.number} ${format(p.number)} ${p.label} ${p.locality || ''}`.toLowerCase().includes(query)) && (!court || p.tribunal === court) && (!filter || filter === 'active' && p.active || filter === 'paused' && !p.active || filter === 'error' && (p.last_error || !configured(p)) || filter === 'unread' && p.unread));
  const rows = simple ? sortProcessList(filtered) : sortTrackingProcesses(filtered, configured);
  state.visibleProcesses = rows;
  $('#processes-view').classList.toggle('simple-mode', simple);
  $('#processes-title').innerHTML = simple ? 'Processos cadastrados<span>.</span>' : 'Seus processos, em dia<span>.</span>';
  $('#processes-subtitle').textContent = simple ? 'Sua lista de processos por estado ou região e comarca, pronta para consultar e copiar.' : 'Acompanhe movimentações e mantenha tudo em um só lugar.';
  $('#processes-view .stats').hidden = simple;
  $('#processes-view .info-note').hidden = simple;
  $('#status-filter').hidden = simple;
  $('#copy-list').hidden = !simple;
  $('#copy-list').disabled = !rows.length;
  $('#portfolio-name').textContent = simple ? 'Lista de processos' : 'Carteira de processos';
  $('#portfolio-description').textContent = simple ? 'UF ou região, comarca e número dos processos cadastrados.' : 'As atualizações mais importantes, perto de você.';
  $('#list-source-note').textContent = simple ? 'Organizada por UF / região e comarca' : 'Ordenada por acompanhamento';
  document.querySelectorAll('[data-process-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.processView === state.processView)));
  $('#process-table-head').innerHTML = simple ? '<tr><th>UF / REGIÃO</th><th>COMARCA / LOCALIDADE</th><th>PROCESSO / IDENTIFICAÇÃO</th><th><span class="sr-only">Ações</span></th></tr>' : '<tr><th>PROCESSO / IDENTIFICAÇÃO</th><th>TRIBUNAL</th><th>ÚLTIMA MOVIMENTAÇÃO</th><th>ACOMPANHAMENTO</th><th><span class="sr-only">Ações</span></th></tr>';
  $('#total-stat').textContent = $('#nav-count').textContent = state.processes.length;
  $('#active-stat').textContent = state.processes.filter(p => p.active).length;
  $('#unread-stat').textContent = $('#nav-unread').textContent = state.processes.reduce((sum,p) => sum + p.unread, 0);
  $('#list-count').textContent = rows.length;
  $('#result-count').textContent = `${rows.length} de ${state.processes.length} processo(s)`;
  $('#empty-state').hidden = !!rows.length;
  $('#empty-state h3').textContent = state.processes.length ? 'Nenhum processo neste filtro' : 'Sua carteira começa aqui';
  $('#empty-add').hidden = !!state.processes.length;
  $('#empty-state p').textContent = state.processes.length ? 'Tente outro número, comarca ou tribunal.' : simple ? 'Adicione seus processos para organizar a lista por estado e comarca.' : 'Adicione um número de processo para organizar o histórico e acompanhar novas movimentações.';
  if (simple) {
    $('#process-list').innerHTML = rows.map(p => `<tr><td><span class="court-tag">${esc(processState(p))}</span></td><td class="simple-locality">${esc(formatLocality(p.locality) || 'Comarca não informada')}</td><td><span class="simple-process-number">${esc(format(p.number))}</span><span class="process-label">${esc(p.label || '')}${p.label ? ' · ' : ''}${p.instance === '1g' ? '1º' : '2º'} grau</span></td><td><button class="button secondary simple-edit" data-edit="${p.id}" aria-label="Editar ${esc(format(p.number))}">Editar</button></td></tr>`).join('');
    return;
  }
  $('#process-list').innerHTML = rows.map(p => {
    const [className, label] = status(p);
    return `<tr><td><button class="process-title" data-detail="${p.id}">${esc(format(p.number))}${p.unread ? `<span class="new-badge">${p.unread} nova(s)</span>` : ''}</button><span class="process-label">${esc(p.label || 'Sem identificação')}</span></td><td><span class="court-tag">${esc(p.tribunal.toUpperCase())}</span><span class="timestamp">${p.instance === '1g' ? '1º' : '2º'} grau</span></td><td><span class="movement-summary">${esc(p.latest_movement || 'Aguardando primeira consulta')}</span><span class="timestamp">${p.latest_movement_at ? esc(date(p.latest_movement_at)) : '—'}</span></td><td><span class="status ${className}">${label}</span><span class="timestamp">${p.checked_at ? 'Verificado ' + esc(date(p.checked_at)) : 'Sem consulta confirmada'}</span>${p.checked_at ? `<span class="timestamp">${esc(sourceNote(p))}</span>` : ''}</td><td><button class="row-arrow" data-detail="${p.id}" aria-label="Ver histórico de ${esc(format(p.number))}">›</button></td></tr>`;
  }).join('');
}
async function refresh() { state.processes = await api('/processes'); render(); if (state.view === 'courts') renderCourts(); }
async function setView(view) {
  state.view = view;
  for (const v of ['processes','notifications','courts']) $(`#${v}-view`).hidden = v !== view;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('selected', button.dataset.view === view));
  $('#breadcrumb').textContent = {processes:'Processos', notifications:'Notificações', courts:'Tribunais'}[view];
  if (view === 'courts') renderCourts();
  if (view === 'notifications') { state.notificationPage = 0; await loadNotifications(false); }
}
function openForm(process) {
  $('#process-form').reset(); $('#edit-id').value = process?.id || ''; $('#form-error').textContent = '';
  $('#form-title').textContent = process ? 'Editar processo' : 'Adicionar processo';
  $('#number').value = process ? format(process.number) : ''; $('#number').disabled = !!process;
  $('#instance').value = process?.instance || '1g'; $('#instance').disabled = !!process;
  $('#label').value = process?.label || ''; $('#notes').value = process?.notes || '';
  $('#locality').value = formatLocality(process?.locality);
  $('#process-dialog').showModal();
}
async function showDetail(id) {
  const p = state.processes.find(p => p.id === id); if (!p) return;
  state.selected = id; state.page = 0; $('#history-source').value = '';
  $('#detail-title').textContent = format(p.number);
  $('#detail-meta').textContent = `${p.tribunal.toUpperCase()} · ${p.instance === '1g' ? '1º' : '2º'} grau · ${p.label || 'Sem identificação'} · Última consulta confirmada: ${date(p.checked_at)}${p.checked_at ? ' · ' + sourceName(p) : ''}`;
  $('#detail-notes').textContent = p.notes;
  $('#detail-error').hidden = !(p.last_error || !configured(p));
  $('#detail-error').textContent = p.last_error || (!configured(p) ? 'A consulta direta deste tribunal/instância aguarda configuração e validação.' : '');
  $('#toggle-process').textContent = p.active ? 'Pausar' : 'Retomar';
  $('#check-process').disabled = !p.active || !configured(p);
  const link = courtProcessLink(p, state.session.courts.find(c => c.id === p.tribunal));
  $('#source-link').href = link.url;
  $('#source-link-help').textContent = link.help;
  $('#source-link-help').hidden = !link.help;
  $('#source-info').hidden = p.last_source !== 'datajud';
  $('#source-info').textContent = p.last_source === 'datajud' ? `Última consulta realizada pelo DataJud porque a consulta direta estava indisponível. Os dados podem ter atraso em relação ao tribunal. Atualização da base: ${p.source_updated_at ? date(p.source_updated_at) : 'não informada'}.` : '';
  $('#timeline').textContent = 'Carregando histórico…';
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  await loadMovements(false);
}
async function loadMovements(append) {
  const id = state.selected;
  const selectedSource = $('#history-source').value;
  const result = await api(`/processes/${id}/movements?page=${state.page}&source=${encodeURIComponent(selectedSource)}`);
  if (id !== state.selected || selectedSource !== $('#history-source').value) return;
  const html = result.items.map(m => `<li><time>${esc(date(m.occurred_at))} · Brasília</time><p>${esc(m.description)}</p></li>`).join('');
  if (append) $('#timeline').insertAdjacentHTML('beforeend', html); else $('#timeline').innerHTML = html || '<li><p>Ainda não há movimentações salvas. Consulte o tribunal para criar o histórico inicial.</p></li>';
  $('#more-movements').hidden = !result.hasMore;
}
async function loadNotifications(append) {
  const result = await api(`/notifications?page=${state.notificationPage}`);
  const html = result.items.map(n => `<article class="notification-card ${n.is_read ? '' : 'unread'}"><h2><button class="process-title" data-detail="${n.process_id}">${esc(n.label || format(n.number))}</button></h2><small>${esc(n.tribunal.toUpperCase())} · Movimento de ${esc(date(n.occurred_at))} · ${n.source === 'datajud' ? 'DataJud' : 'Tribunal'}</small><p>${esc(n.description)}</p><small>Encontrado em ${esc(date(n.created_at))}</small><br>${n.is_read ? '<small>Lido</small>' : `<button class="button secondary" data-read="${n.id}">Marcar como lido</button>`}</article>`).join('');
  if (append) $('#notifications-list').insertAdjacentHTML('beforeend',html); else $('#notifications-list').innerHTML = html || '<div class="empty panel"><div class="empty-icon">↗</div><h3>Tudo em dia por aqui</h3><p>Os próximos movimentos encontrados aparecerão nesta central.</p></div>';
  $('#more-notifications').hidden = !result.hasMore;
}
function courtNote(court) {
  const fallback = court.instances.some(i => i.datajudAvailable);
  const direct = court.instances.some(i => i.directConfigured);
  const note = court.id === 'tjgo' ? 'Conector público do Projudi para 1º grau. A comarca pode ser preenchida manualmente.'
    : court.branch === 'labor' ? 'A consulta direta ao PJe pode exigir credenciamento pelo tribunal.'
    : direct ? 'O acesso direto depende da disponibilidade e das permissões do tribunal.'
    : 'A consulta direta depende de serviço compatível e acesso autorizado pelo tribunal.';
  return note + (fallback ? ' Quando a consulta direta não estiver disponível, o DataJud será usado como alternativa pública.' : '');
}
function renderCourts() {
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = normalize($('#court-search').value.trim());
  const branch = $('#court-branch').value, availability = $('#court-availability').value;
  const courts = state.session.courts.filter(c => (!query || normalize(`${c.id} ${c.name}`).includes(query)) && (!branch || c.branch === branch) && (!availability || !!c.instances.find(i => i.instance === '1g')?.directConfigured === (availability === 'configured')));
  $('#court-result-count').textContent = `${courts.length} de ${state.session.courts.length} tribunal(is)`;
  $('#courts-list').innerHTML = courts.map(c => `<article class="court-card"><h2>${esc(c.id.toUpperCase())} · ${esc(c.name)}</h2><p>${esc(c.system)} · ${esc({state:'Justiça Estadual',federal:'Justiça Federal',labor:'Justiça do Trabalho'}[c.branch] || 'Consulta direta')}</p>${c.instances.map(i => {
    const confirmed = state.processes.some(p => p.tribunal === c.id && p.instance === i.instance && p.initialized && p.checked_at && !p.last_error);
    const failed = state.processes.some(p => p.tribunal === c.id && p.instance === i.instance && p.last_error);
    const confirmedSource = state.processes.find(p => p.tribunal === c.id && p.instance === i.instance && p.initialized && p.checked_at && !p.last_error)?.last_source;
    const label = failed ? 'Verificar consulta' : confirmed ? confirmedSource === 'datajud' ? 'Consulta via DataJud' : 'Consulta direta confirmada' : i.directConfigured ? i.datajudAvailable ? 'Direta + alternativa DataJud' : 'Aguardando primeira consulta' : i.datajudAvailable ? 'Disponível via DataJud' : i.requiresCredentials ? 'Aguarda credenciamento' : 'Aguarda configuração';
    return `<div class="instance-state"><span>${i.instance === '1g' ? '1º' : '2º'} grau</span><span class="status ${i.configured && confirmed && !failed ? 'ok' : 'error'}">${label}</span></div>`;
  }).join('')}<p>${esc(courtNote(c))}</p><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Consulta oficial ↗</a></article>`).join('');
}
async function handleClick(event) {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.view) return setView(button.dataset.view);
  if (button.id === 'copy-process-number') {
    const p = state.processes.find(p => p.id === state.selected); if (!p) return;
    try { await navigator.clipboard.writeText(format(p.number)); toast('Número do processo copiado.'); }
    catch { $('#detail-title').focus(); const range = document.createRange(); range.selectNodeContents($('#detail-title')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Número selecionado. Use a opção Copiar do navegador.'); }
    return;
  }
  if (button.dataset.processView) {
    state.processView = button.dataset.processView;
    try { localStorage.setItem('temis.processView', state.processView); } catch {}
    render(); return;
  }
  if (button.dataset.close) return $(`#${button.dataset.close}`).close();
  if (button.dataset.detail) return showDetail(button.dataset.detail);
  if (button.dataset.edit) return openForm(state.processes.find(p => p.id === button.dataset.edit));
  if (button.dataset.read) return busy(button, async () => { await api(`/notifications/${button.dataset.read}/read`, 'POST'); await refresh(); const page = state.notificationPage; state.notificationPage = 0; await loadNotifications(false); for(let i=1;i<=page;i++){state.notificationPage=i;await loadNotifications(true);} });
  const p = state.processes.find(p => p.id === state.selected);
  switch(button.id) {
    case 'new-process': case 'empty-add': return openForm();
    case 'refresh': return busy(button, async () => { await refresh(); toast('Lista atualizada.'); });
    case 'copy-list': {
      const text = processListText(state.visibleProcesses);
      if (!text) return;
      try { await navigator.clipboard.writeText(text); toast('Lista copiada.'); }
      catch { $('#copy-text').value = text; $('#copy-dialog').showModal(); $('#copy-text').select(); }
      return;
    }
    case 'check-process': return busy(button, async () => { const result = await api(`/processes/${p.id}/check`, 'POST'); await refresh(); await showDetail(p.id); toast(result.added ? `${result.added} movimentação(ões) encontrada(s).` : 'Consulta concluída. Histórico atualizado.'); });
    case 'edit-process': return openForm(p);
    case 'toggle-process': return busy(button, async () => { await api(`/processes/${p.id}`, 'PATCH', {active:!p.active}); await refresh(); await showDetail(p.id); });
    case 'delete-process': return $('#delete-dialog').showModal();
    case 'confirm-delete': return busy(button, async () => { await api(`/processes/${p.id}`, 'DELETE'); $('#delete-dialog').close(); $('#detail-dialog').close(); await refresh(); if (state.view === 'notifications') await setView('notifications'); toast('Processo excluído.'); });
    case 'more-movements': return busy(button, async () => { state.page++; try { await loadMovements(true); } catch(e) {state.page--;throw e;} });
    case 'more-notifications': return busy(button, async () => { state.notificationPage++; try {await loadNotifications(true);} catch(e) {state.notificationPage--;throw e;} });
  }
}
document.addEventListener('click', event => { error(''); handleClick(event).catch(async e => { error(e.message); if ($('#detail-dialog').open) { $('#detail-error').textContent = e.message; $('#detail-error').hidden = false; } }); });
$('#history-source').addEventListener('change', () => { state.page = 0; loadMovements(false).catch(e => error(e.message)); });
$('#source-link').addEventListener('click', () => {
  const p = state.processes.find(p => p.id === state.selected); if (!p) return;
  navigator.clipboard?.writeText(format(p.number)).then(() => toast('Número do processo copiado.')).catch(() => {});
});
for (const selector of ['#search','#court-filter','#status-filter']) $(selector).addEventListener('input', render);
for (const selector of ['#court-search','#court-branch','#court-availability']) $(selector).addEventListener('input', renderCourts);
$('#process-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#form-error').textContent = '';
  try { await busy($('#save-process'), async () => {
    const id = $('#edit-id').value;
    const payload = {number:$('#number').value, instance:$('#instance').value, label:$('#label').value, notes:$('#notes').value, locality:$('#locality').value};
    const saved = await api(id ? `/processes/${id}` : '/processes', id ? 'PATCH' : 'POST', payload);
    $('#process-dialog').close(); await refresh(); const selected = id || saved.id;
    if (state.processView !== 'simple') await showDetail(selected);
    toast(id ? 'Processo atualizado.' : 'Processo salvo.');
    if (!id && configured(state.processes.find(p => p.id === selected))) {
      await busy($('#check-process'), async () => { await api(`/processes/${selected}/check`,'POST'); await refresh(); if(state.selected===selected && $('#detail-dialog').open) await showDetail(selected); });
    }
  }); } catch(e) { if ($('#process-dialog').open) $('#form-error').textContent = e.message; else { error(e.message); if ($('#detail-dialog').open) { $('#detail-error').textContent=e.message;$('#detail-error').hidden=false; } await refresh().catch(()=>{}); } }
});
async function start() {
  try {
    state.session = await api('/session'); $('#user-email').textContent = state.session.email;
    for (const [branch, label] of Object.entries({state:'Justiça Estadual',federal:'Justiça Federal',labor:'Justiça do Trabalho'})) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const court of state.session.courts.filter(c => c.branch === branch)) {
        const option = document.createElement('option'); option.value = court.id; option.textContent = `${court.id.toUpperCase()} · ${court.name}`; group.append(option);
      }
      $('#court-filter').append(group);
    }
    renderCourts(); await refresh();
    setInterval(async () => { if(document.hidden || document.querySelector('dialog[open]'))return; try {await refresh();if(state.view==='notifications'){state.notificationPage=0;await loadNotifications(false);}}catch(e){error(e.message);} },60000);
  } catch(e) { error(e.message); $('#user-email').textContent = 'Acesso indisponível'; $('#result-count').textContent = 'Não foi possível carregar os processos.'; }
}
bindCnjMask($('#number'));
start();
