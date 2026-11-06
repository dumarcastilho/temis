import { bindCnjMask } from './cnj-mask.js';
const $ = selector => document.querySelector(selector);
const state = { processes: [], session: null, selected: null, page: 0, notificationPage: 0, view: 'processes' };
const format = n => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
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
function status(p) { return !p.active ? ['paused', 'Pausado'] : p.last_error ? ['error','Precisa de atenção'] : !configured(p) ? ['error','Integração pendente'] : !p.initialized ? ['paused','Primeira consulta pendente'] : ['ok','Em acompanhamento']; }
function render() {
  const query = $('#search').value.toLowerCase().trim(), court = $('#court-filter').value, filter = $('#status-filter').value;
  const rows = state.processes.filter(p => (!query || `${p.number} ${format(p.number)} ${p.label}`.toLowerCase().includes(query)) && (!court || p.tribunal === court) && (!filter || filter === 'active' && p.active || filter === 'paused' && !p.active || filter === 'error' && (p.last_error || !configured(p)) || filter === 'unread' && p.unread));
  $('#total-stat').textContent = $('#nav-count').textContent = state.processes.length;
  $('#active-stat').textContent = state.processes.filter(p => p.active).length;
  $('#unread-stat').textContent = $('#nav-unread').textContent = state.processes.reduce((sum,p) => sum + p.unread, 0);
  $('#list-count').textContent = rows.length;
  $('#result-count').textContent = `${rows.length} de ${state.processes.length} processo(s)`;
  $('#empty-state').hidden = !!rows.length;
  $('#empty-state h3').textContent = state.processes.length ? 'Nenhum processo neste filtro' : 'Sua carteira começa aqui';
  $('#empty-add').hidden = !!state.processes.length;
  $('#empty-state p').textContent = state.processes.length ? 'Tente outro número, tribunal ou status.' : 'Adicione um número de processo para organizar o histórico e acompanhar novas movimentações.';
  $('#process-list').innerHTML = rows.map(p => {
    const [className, label] = status(p);
    return `<tr><td><button class="process-title" data-detail="${p.id}">${esc(format(p.number))}${p.unread ? `<span class="new-badge">${p.unread} nova(s)</span>` : ''}</button><span class="process-label">${esc(p.label || 'Sem identificação')}</span></td><td><span class="court-tag">${esc(p.tribunal.toUpperCase())}</span><span class="timestamp">${p.instance === '1g' ? '1º' : '2º'} grau</span></td><td><span class="movement-summary">${esc(p.latest_movement || 'Aguardando primeira consulta')}</span><span class="timestamp">${p.latest_movement_at ? esc(date(p.latest_movement_at)) : '—'}</span></td><td><span class="status ${className}">${label}</span><span class="timestamp">${p.checked_at ? 'Verificado ' + esc(date(p.checked_at)) : 'Sem consulta confirmada'}</span></td><td><button class="row-arrow" data-detail="${p.id}" aria-label="Ver histórico de ${esc(format(p.number))}">›</button></td></tr>`;
  }).join('');
}
async function refresh() { state.processes = await api('/processes'); render(); }
async function setView(view) {
  state.view = view;
  for (const v of ['processes','notifications','courts']) $(`#${v}-view`).hidden = v !== view;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('selected', button.dataset.view === view));
  $('#breadcrumb').textContent = {processes:'Processos', notifications:'Notificações', courts:'Tribunais'}[view];
  if (view === 'notifications') { state.notificationPage = 0; await loadNotifications(false); }
}
function openForm(process) {
  $('#process-form').reset(); $('#edit-id').value = process?.id || ''; $('#form-error').textContent = '';
  $('#form-title').textContent = process ? 'Editar processo' : 'Adicionar processo';
  $('#number').value = process ? format(process.number) : ''; $('#number').disabled = !!process;
  $('#instance').value = process?.instance || '1g'; $('#instance').disabled = !!process;
  $('#label').value = process?.label || ''; $('#notes').value = process?.notes || '';
  $('#process-dialog').showModal();
}
async function showDetail(id) {
  const p = state.processes.find(p => p.id === id); if (!p) return;
  state.selected = id; state.page = 0;
  $('#detail-title').textContent = format(p.number);
  $('#detail-meta').textContent = `${p.tribunal.toUpperCase()} · ${p.instance === '1g' ? '1º' : '2º'} grau · ${p.label || 'Sem identificação'} · Última consulta confirmada: ${date(p.checked_at)}`;
  $('#detail-notes').textContent = p.notes;
  $('#detail-error').hidden = !(p.last_error || !configured(p));
  $('#detail-error').textContent = p.last_error || (!configured(p) ? 'A consulta direta deste tribunal/instância aguarda configuração e validação.' : '');
  $('#toggle-process').textContent = p.active ? 'Pausar' : 'Retomar';
  $('#check-process').disabled = !p.active || !configured(p);
  $('#source-link').href = state.session.courts.find(c => c.id === p.tribunal).url;
  $('#timeline').textContent = 'Carregando histórico…';
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  await loadMovements(false);
}
async function loadMovements(append) {
  const id = state.selected;
  const result = await api(`/processes/${id}/movements?page=${state.page}`);
  if (id !== state.selected) return;
  const html = result.items.map(m => `<li><time>${esc(date(m.occurred_at))} · Brasília</time><p>${esc(m.description)}</p></li>`).join('');
  if (append) $('#timeline').insertAdjacentHTML('beforeend', html); else $('#timeline').innerHTML = html || '<li><p>Ainda não há movimentações salvas. Consulte o tribunal para criar o histórico inicial.</p></li>';
  $('#more-movements').hidden = !result.hasMore;
}
async function loadNotifications(append) {
  const result = await api(`/notifications?page=${state.notificationPage}`);
  const html = result.items.map(n => `<article class="notification-card ${n.is_read ? '' : 'unread'}"><h2><button class="process-title" data-detail="${n.process_id}">${esc(n.label || format(n.number))}</button></h2><small>${esc(n.tribunal.toUpperCase())} · Movimento de ${esc(date(n.occurred_at))}</small><p>${esc(n.description)}</p><small>Encontrado em ${esc(date(n.created_at))}</small><br>${n.is_read ? '<small>Lido</small>' : `<button class="button secondary" data-read="${n.id}">Marcar como lido</button>`}</article>`).join('');
  if (append) $('#notifications-list').insertAdjacentHTML('beforeend',html); else $('#notifications-list').innerHTML = html || '<div class="empty panel"><div class="empty-icon">↗</div><h3>Tudo em dia por aqui</h3><p>Os próximos movimentos encontrados aparecerão nesta central.</p></div>';
  $('#more-notifications').hidden = !result.hasMore;
}
function renderCourts() {
  $('#courts-list').innerHTML = state.session.courts.map(c => `<article class="court-card"><h2>${esc(c.id.toUpperCase())} · ${esc(c.name)}</h2><p>${esc(c.system)} · Consulta direta</p>${c.instances.map(i => `<div class="instance-state"><span>${i.instance === '1g' ? '1º' : '2º'} grau</span><span class="status ${i.configured ? 'ok' : 'error'}">${i.configured ? 'Conector configurado' : 'Aguarda integração'}</span></div>`).join('')}<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Consulta oficial ↗</a></article>`).join('');
}
async function handleClick(event) {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.view) return setView(button.dataset.view);
  if (button.dataset.close) return $(`#${button.dataset.close}`).close();
  if (button.dataset.detail) return showDetail(button.dataset.detail);
  if (button.dataset.read) return busy(button, async () => { await api(`/notifications/${button.dataset.read}/read`, 'POST'); await refresh(); const page = state.notificationPage; state.notificationPage = 0; await loadNotifications(false); for(let i=1;i<=page;i++){state.notificationPage=i;await loadNotifications(true);} });
  const p = state.processes.find(p => p.id === state.selected);
  switch(button.id) {
    case 'new-process': case 'empty-add': return openForm();
    case 'refresh': return busy(button, async () => { await refresh(); toast('Lista atualizada.'); });
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
for (const selector of ['#search','#court-filter','#status-filter']) $(selector).addEventListener('input', render);
$('#process-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#form-error').textContent = '';
  try { await busy($('#save-process'), async () => {
    const id = $('#edit-id').value;
    const payload = {number:$('#number').value, instance:$('#instance').value, label:$('#label').value, notes:$('#notes').value};
    const saved = await api(id ? `/processes/${id}` : '/processes', id ? 'PATCH' : 'POST', payload);
    $('#process-dialog').close(); await refresh(); const selected = id || saved.id; await showDetail(selected);
    toast(id ? 'Processo atualizado.' : 'Processo salvo. Preparando a primeira consulta.');
    if (!id && configured(state.processes.find(p => p.id === selected))) {
      await busy($('#check-process'), async () => { await api(`/processes/${selected}/check`,'POST'); await refresh(); if(state.selected===selected && $('#detail-dialog').open) await showDetail(selected); });
    }
  }); } catch(e) { if ($('#process-dialog').open) $('#form-error').textContent = e.message; else { $('#detail-error').textContent=e.message;$('#detail-error').hidden=false; await refresh().catch(()=>{}); } }
});
async function start() {
  try {
    state.session = await api('/session'); $('#user-email').textContent = state.session.email;
    for(const court of state.session.courts) { const option = document.createElement('option'); option.value=court.id;option.textContent=court.id.toUpperCase();$('#court-filter').append(option); }
    renderCourts(); await refresh();
    setInterval(async () => { if(document.hidden || document.querySelector('dialog[open]'))return; try {await refresh();if(state.view==='notifications'){state.notificationPage=0;await loadNotifications(false);}}catch(e){error(e.message);} },60000);
  } catch(e) { error(e.message); $('#user-email').textContent = 'Acesso indisponível'; $('#result-count').textContent = 'Não foi possível carregar os processos.'; }
}
bindCnjMask($('#number'));
start();
