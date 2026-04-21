// filepath: resources/js/bot.js
console.log('✅ Bot Manager Engine Initialized');

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    currentEditorFile: null,
    monacoInstance: null,
    globalFiles: [],
    modulesMetadata: [],
    modalActive: false,
    currentConfigClient: null,
    currentConfigCommand: null,
    clientChats: [],
    calendarInstance: null
  };

  try {
    const dataEl = document.getElementById('app-data');
    if (dataEl && dataEl.dataset.commands) state.globalFiles = JSON.parse(dataEl.dataset.commands);
    if (dataEl && dataEl.dataset.modules) state.modulesMetadata = JSON.parse(dataEl.dataset.modules);
  } catch (e) {}

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return; 
    const toast = document.createElement('div');
    const bgClass = type === 'success' ? 'bg-emerald-600' : (type === 'error' ? 'bg-red-600' : 'bg-slate-800');
    const icon = type === 'success' ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>' : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>';
    toast.className = `${bgClass} text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-auto`;
    toast.innerHTML = `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icon}</svg><span class="text-sm font-medium">${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.classList.remove('translate-y-10', 'opacity-0'); toast.classList.add('translate-y-0', 'opacity-100'); });
    setTimeout(() => { toast.classList.remove('translate-y-0', 'opacity-100'); toast.classList.add('translate-y-10', 'opacity-0'); setTimeout(() => toast.remove(), 3500); }, 3500);
  }

  function switchTab(target) {
    const tabs = ['clients', 'editor', 'planner', 'analytics', 'api'];
    tabs.forEach(t => {
      const el = document.getElementById(`tab-${t}`);
      const btn = document.getElementById(`tab-${t}-btn`);
      if (el && btn) {
        if (t === target) {
          el.classList.remove('hidden');
          btn.className = 'px-4 py-2 rounded-lg font-semibold text-sm bg-indigo-600/20 text-indigo-300 shadow-inner transition-all';
        } else {
          el.classList.add('hidden');
          btn.className = 'px-4 py-2 rounded-lg font-semibold text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all';
        }
      }
    });

    if (target === 'editor' && !state.monacoInstance && window.require) {
      initEditor();
      loadEditorFiles();
    }
    
    if (target === 'planner') {
      refreshPlannerClients();
      initCalendar();
    }

    if (target === 'analytics') {
      refreshAnalyticsClients();
      loadAnalyticsData();
    }

    if (target === 'api') {
      if (!document.getElementById('api-logs-container').innerHTML.includes('border')) {
        loadApiLogs();
      }
    }
  }

  /* --- API Gateway Logic --- */

  document.getElementById('global-api-toggle')?.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    const label = document.getElementById('api-status-label');
    try {
      const res = await fetch('/whatsapp-manager/api/settings/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: isEnabled })
      });
      const data = await res.json();
      if (data.success) {
        label.textContent = data.apiStatus ? 'Activado' : 'Desactivado';
        label.className = `text-[11px] font-extrabold uppercase tracking-wide ml-2 ${data.apiStatus ? 'text-emerald-600' : 'text-slate-400'}`;
        showToast(`Envío de API ${data.apiStatus ? 'Activado' : 'Desactivado'}`);
      }
    } catch(err) {
      showToast('Error al cambiar el estado de la API', 'error');
      e.target.checked = !isEnabled;
    }
  });

  document.getElementById('btn-refresh-logs')?.addEventListener('click', loadApiLogs);
  document.getElementById('btn-clear-logs')?.addEventListener('click', async () => {
    if (!confirm('¿Limpiar todo el registro de la API?')) return;
    try {
      const res = await fetch('/whatsapp-manager/api/logs', { method: 'DELETE' });
      if ((await res.json()).success) {
        loadApiLogs();
        showToast('Registros eliminados');
      }
    } catch(e) {}
  });

  async function loadApiLogs() {
    const container = document.getElementById('api-logs-container');
    if (!container) return;
    container.innerHTML = '<div class="flex justify-center py-10"><div class="spinner spinner-dark"></div></div>';
    try {
      const res = await fetch('/whatsapp-manager/api/logs');
      const data = await res.json();
      if (!data.success || data.logs.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-500 text-sm py-10 font-medium">Aún no hay actividad registrada en la API.</div>';
        return;
      }
      container.innerHTML = data.logs.map(log => `
        <div class="bg-white border border-slate-200 shadow-sm rounded-2xl p-5 flex gap-4 items-start hover:shadow-md transition-shadow relative group">
          <div class="shrink-0 pt-1">
            ${log.status === 'success' ? '<div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></div>' : 
              log.status === 'blocked' ? '<div class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg></div>' :
              '<div class="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></div>'}
          </div>
          <div class="flex-grow min-w-0">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[11px] font-extrabold text-slate-500 tracking-wider uppercase">${new Date(log.timestamp).toLocaleString()}</span>
              <span class="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">${log.clientId}</span>
            </div>
            <p class="text-sm font-bold text-slate-800 break-words mb-1.5 leading-snug">${log.payloadSummary}</p>
            <p class="text-[11px] font-medium text-slate-500 truncate" title="${log.target}">Destino: <span class="font-mono text-indigo-600 font-bold">${log.target}</span></p>
            ${log.error ? `<p class="text-xs text-red-600 mt-2 font-semibold bg-red-50 p-2.5 rounded-lg border border-red-100">${log.error}</p>` : ''}
          </div>
          <button data-action="delete-log" data-id="${log.id}" class="absolute top-4 right-4 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white rounded-full">
             <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      `).join('');
    } catch (e) {
      container.innerHTML = '<div class="text-center text-red-500 text-sm py-10 font-bold">Error al cargar registros.</div>';
    }
  }

  let cachedDirectory = [];
  document.getElementById('directory-client-select')?.addEventListener('change', async (e) => {
    const clientId = e.target.value;
    const container = document.getElementById('directory-contacts-container');
    if (!clientId) {
      container.innerHTML = '<div class="flex items-center justify-center h-full text-sm text-slate-400 font-medium text-center px-6">Seleccione una instancia para ver sus contactos y grupos sincronizados.</div>';
      cachedDirectory = [];
      return;
    }
    container.innerHTML = '<div class="flex justify-center py-10"><div class="spinner spinner-dark"></div></div>';
    try {
      const res = await fetch(`/whatsapp-manager/api/chats/${clientId}`);
      const data = await res.json();
      if (data.success) {
        cachedDirectory = data.chats;
        renderDirectory(cachedDirectory);
      } else {
        container.innerHTML = '<div class="text-center text-red-500 text-sm py-10 font-bold">Error al obtener contactos. ¿Está conectada la instancia?</div>';
      }
    } catch(err) {
      container.innerHTML = '<div class="text-center text-red-500 text-sm py-10 font-bold">Error de red.</div>';
    }
  });

  document.getElementById('directory-search')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    if (!term) return renderDirectory(cachedDirectory);
    const filtered = cachedDirectory.filter(c => c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term));
    renderDirectory(filtered);
  });

  function renderDirectory(chats) {
    const container = document.getElementById('directory-contacts-container');
    if (chats.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-500 text-sm py-10 font-medium">No se encontraron contactos.</div>';
      return;
    }
    container.innerHTML = chats.map(c => `
      <div class="flex items-center justify-between p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors rounded-xl group">
        <div class="flex flex-col overflow-hidden w-full">
          <div class="flex items-center gap-2 mb-1">
             <span class="text-sm font-bold text-slate-700 truncate" title="${c.name}">${c.name}</span>
             ${c.isGroup ? '<span class="px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-purple-100 text-purple-700 border border-purple-200">Grupo</span>' : ''}
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-500 font-mono font-medium select-all">${c.id}</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  /* --- Analytics Visualization --- */
  
  function refreshAnalyticsClients() {
    const select = document.getElementById('analytics-client-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Seleccionar Instancia...</option>';
    document.querySelectorAll('[id^="client-"]').forEach(el => {
      const clientId = el.id.replace('client-', '');
      if (clientId) {
        const opt = document.createElement('option');
        opt.value = clientId;
        opt.textContent = clientId;
        select.appendChild(opt);
      }
    });
    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
      select.value = currentVal;
    }
  }

  document.getElementById('analytics-client-select')?.addEventListener('change', loadAnalyticsData);
  document.getElementById('btn-refresh-analytics')?.addEventListener('click', loadAnalyticsData);

  async function loadAnalyticsData() {
    const clientId = document.getElementById('analytics-client-select').value;
    const tbody = document.getElementById('analytics-table-body');
    if (!clientId) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500 text-sm font-medium">Seleccione una instancia para ver el rendimiento histórico</td></tr>';
      return;
    }

    tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500"><div class="spinner spinner-dark mx-auto"></div></td></tr>';

    try {
      const res = await fetch(`/whatsapp-manager/api/schedules/${clientId}`);
      const data = await res.json();
      if (!data.success) throw new Error();

      const statuses = data.schedules.filter(s => ['postTextStatus', 'postMediaStatus'].includes(s.type) && s.statusMessageId);
      
      if (statuses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500 text-sm font-medium">No se encontraron estados publicados con visualizaciones rastreables para esta instancia.</td></tr>';
        return;
      }

      statuses.sort((a, b) => (b.lastRunAt || b.timestamp || 0) - (a.lastRunAt || a.timestamp || 0));
      const maxViews = Math.max(...statuses.map(s => s.viewsCount || 0), 1);

      tbody.innerHTML = statuses.map(s => {
        const date = new Date(s.lastRunAt || s.timestamp || s.createdAt).toLocaleString();
        const isText = s.type === 'postTextStatus';
        const typeBadge = isText ? '<span class="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-[11px] font-extrabold uppercase tracking-wide">Texto</span>' : '<span class="px-2.5 py-1 bg-purple-50 border border-purple-200 text-purple-700 rounded-md text-[11px] font-extrabold uppercase tracking-wide">Multimedia</span>';
        
        let preview = '';
        if (isText) {
            preview = `<div class="max-w-xs truncate font-bold px-3 py-1.5 rounded-lg border border-black/5 shadow-sm" style="background-color: ${s.backgroundColor || '#eee'}; color: #fff;">${s.statusText}</div>`;
        } else {
            preview = `<div class="max-w-xs truncate font-bold text-slate-800">${s.caption || '<em class="text-slate-400 font-medium">Sin pie de foto</em>'}</div><div class="text-[10px] text-slate-400 truncate w-48 mt-0.5">${s.mediaPath}</div>`;
        }

        const views = s.viewsCount || 0;
        const widthPct = Math.round((views / maxViews) * 100);

        return `
          <tr class="hover:bg-slate-50/80 transition-colors">
            <td class="px-6 py-5 whitespace-nowrap text-sm font-medium text-slate-600">${date}</td>
            <td class="px-6 py-5 whitespace-nowrap">${typeBadge}</td>
            <td class="px-6 py-5">${preview}</td>
            <td class="px-6 py-5 whitespace-nowrap">
              <div class="flex items-center gap-4">
                <span class="font-extrabold text-slate-800 w-8 text-right">${views}</span>
                <div class="w-32 bg-slate-200 rounded-full h-2.5 overflow-hidden shadow-inner">
                  <div class="bg-indigo-500 h-2.5 rounded-full" style="width: ${widthPct}%"></div>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-red-500 text-sm font-bold">Error al cargar datos analíticos.</td></tr>';
    }
  }


  /* --- Planner & Calendar Initialization --- */

  function refreshPlannerClients() {
    const select = document.getElementById('planner-client-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Seleccionar Instancia...</option>';
    document.querySelectorAll('[id^="client-"]').forEach(el => {
      const clientId = el.id.replace('client-', '');
      if (clientId) {
        const opt = document.createElement('option');
        opt.value = clientId;
        opt.textContent = clientId;
        select.appendChild(opt);
      }
    });
    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
      select.value = currentVal;
    }
  }

  document.getElementById('planner-client-select')?.addEventListener('change', () => {
    if (state.calendarInstance) state.calendarInstance.refetchEvents();
  });

  function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl || state.calendarInstance) return;

    state.calendarInstance = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      locale: 'es',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listMonth'
      },
      buttonText: {
        today: 'Hoy',
        month: 'Mes',
        week: 'Semana',
        list: 'Lista'
      },
      events: fetchCalendarEvents,
      eventClick: function(info) {
        openViewSchedule(info.event.extendedProps.schedule);
      }
    });
    state.calendarInstance.render();
  }

  function fetchCalendarEvents(info, successCallback, failureCallback) {
    const clientId = document.getElementById('planner-client-select').value;
    if (!clientId) return successCallback([]);

    fetch(`/whatsapp-manager/api/schedules/${clientId}`)
      .then(r => r.json())
      .then(data => {
         const events = [];
         data.schedules.forEach(s => {
           let title = '';
           let color = '#4f46e5';
           if (s.type === 'message') { title = s.message || (s.mediaPath ? 'Multimedia' : 'Mensaje'); color = '#4f46e5'; }
           else if (s.type === 'postTextStatus') { title = `Estado: ${s.statusText || 'Texto'}`; color = '#10b981'; }
           else if (s.type === 'postMediaStatus') { title = `Estado: ${s.caption || 'Multimedia'}`; color = '#10b981'; }
           else if (s.type === 'revokeStatus') { title = `Eliminar Estado`; color = '#ef4444'; }
           
           if (!s.isRecurring && s.timestamp) {
               const t = new Date(s.timestamp);
               if (t >= info.start && t <= info.end) {
                   events.push({ id: s.id, title, start: t, backgroundColor: color, borderColor: color, extendedProps: { schedule: s } });
               }
           } else if (s.isRecurring && s.recurrence) {
               let current = new Date(info.start);
               while (current <= info.end) {
                   const y = current.getFullYear();
                   const m = String(current.getMonth() + 1).padStart(2, '0');
                   const d = String(current.getDate()).padStart(2, '0');
                   const eventTime = new Date(`${y}-${m}-${d}T${s.recurrence.time}:00`);
                   
                   let match = false;
                   if (s.recurrence.type === 'daily') match = true;
                   else if (s.recurrence.type === 'weekly' && s.recurrence.daysOfWeek.includes(current.getDay())) match = true;
                   else if (s.recurrence.type === 'monthly' && s.recurrence.dayOfMonth === current.getDate()) match = true;

                   if (match) {
                       events.push({ id: s.id + '_' + eventTime.getTime(), title: '🔁 ' + title, start: eventTime, backgroundColor: color, borderColor: color, extendedProps: { schedule: s } });
                   }
                   current.setDate(current.getDate() + 1);
               }
           }
         });
         successCallback(events);
      }).catch(failureCallback);
  }

  /* --- Planner UI UX Logic --- */

  document.querySelectorAll('.schedule-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const isRecurring = e.target.dataset.scheduleMode === 'true';
      document.getElementById('schedule-isRecurring').value = isRecurring ? 'true' : 'false';
      
      const parent = e.target.parentElement;
      Array.from(parent.children).forEach(c => {
        c.className = 'schedule-mode-btn flex-1 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 rounded-xl transition-all';
      });
      e.target.className = 'schedule-mode-btn flex-1 py-2 text-sm font-bold bg-white text-indigo-700 shadow-sm rounded-xl transition-all';
      
      document.getElementById('schedule-timing-one-time').classList.toggle('hidden', isRecurring);
      document.getElementById('schedule-timing-recurring').classList.toggle('hidden', !isRecurring);
      
      if (!isRecurring) document.querySelector('input[name="datetime"]').setAttribute('required', 'true');
      else document.querySelector('input[name="datetime"]').removeAttribute('required');
    });
  });

  document.getElementById('schedule-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const isTextStatus = val === 'postTextStatus';
    const isMediaStatus = val === 'postMediaStatus';
    const isMsg = val === 'message';

    document.getElementById('schedule-fields-message').classList.toggle('hidden', !isMsg);
    document.getElementById('schedule-fields-text-status').classList.toggle('hidden', !isTextStatus);
    document.getElementById('schedule-fields-media-status').classList.toggle('hidden', !isMediaStatus);
    document.getElementById('schedule-fields-revoke').classList.toggle('hidden', val !== 'revokeStatus');

    const form = e.target.closest('form');
    if (form) {
        const msgInput = form.querySelector('[name="message"]');
        if (msgInput) msgInput.required = isMsg;

        const statusTextInput = form.querySelector('[name="statusText"]');
        if (statusTextInput) statusTextInput.required = isTextStatus;
    }
  });

  document.getElementById('schedule-recurrence-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('schedule-recurrence-weekly').classList.toggle('hidden', val !== 'weekly');
    document.getElementById('schedule-recurrence-monthly').classList.toggle('hidden', val !== 'monthly');
  });

  document.getElementById('btn-load-planner-chats')?.addEventListener('click', async () => {
    const clientId = document.getElementById('planner-client-select').value;
    const container = document.getElementById('planner-chats-container');
    container.innerHTML = '<div class="spinner spinner-dark mx-auto my-3"></div>';
    container.classList.remove('hidden');
    try {
      const res = await fetch(`/whatsapp-manager/api/chats/${clientId}`);
      const data = await res.json();
      if (data.success && data.chats.length > 0) {
        container.innerHTML = data.chats.map(c => `
          <label class="flex items-center gap-3 p-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 cursor-pointer transition-colors rounded-lg group">
            <input type="checkbox" value="${c.id}" class="planner-chat-cb rounded-md w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 transition-all">
            <div class="flex flex-col overflow-hidden"><span class="text-xs font-bold text-slate-700 truncate w-full" title="${c.name}">${c.name}</span><span class="text-[10px] text-slate-400 font-mono font-medium">${c.id}</span></div>
          </label>
        `).join('');
      } else {
        container.innerHTML = '<p class="text-xs font-semibold text-slate-500 p-3">No se encontraron conexiones accesibles.</p>';
      }
    } catch (err) {
      container.innerHTML = '<p class="text-xs font-bold text-red-500 p-3">Fallo al establecer comunicación con los contactos.</p>';
    }
  });

  document.getElementById('btn-save-schedule')?.addEventListener('click', async () => {
    const clientId = document.getElementById('planner-client-select').value;
    const form = document.getElementById('schedule-form');
    
    if(!clientId) return showToast('Instancia no seleccionada.', 'error');
    if(!form.checkValidity()) return form.reportValidity();

    const type = document.getElementById('schedule-type').value;

    if (type === 'postMediaStatus') {
       const fileInput = form.querySelector('[name="statusMediaFile"]');
       const pathInput = form.querySelector('[name="statusMediaPath"]').value;
       if (!fileInput.files[0] && !pathInput.trim()) {
           return showToast('Debe proporcionar un archivo o URL para publicar un Estado Multimedia.', 'error');
       }
    }

    const btn = document.getElementById('btn-save-schedule');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Guardando...'; btn.disabled = true;

    const isRecurring = document.getElementById('schedule-isRecurring').value === 'true';

    const formData = new FormData();
    formData.append('type', type);
    formData.append('isRecurring', isRecurring);

    if (type === 'message') {
      const chatIds = Array.from(document.querySelectorAll('.planner-chat-cb:checked')).map(cb => cb.value);
      chatIds.forEach(id => formData.append('chatIds[]', id));
      formData.append('message', form.querySelector('[name="message"]').value);
      const fileInput = form.querySelector('[name="messageFile"]');
      if (fileInput.files[0]) formData.append('file', fileInput.files[0]);
      else formData.append('mediaPath', form.querySelector('[name="mediaPath"]').value);
    } else if (type === 'postTextStatus') {
      formData.append('statusText', form.querySelector('[name="statusText"]').value);
      formData.append('backgroundColor', form.querySelector('[name="backgroundColor"]').value);
      formData.append('fontStyle', form.querySelector('[name="fontStyle"]').value);
    } else if (type === 'postMediaStatus') {
      formData.append('caption', form.querySelector('[name="statusCaption"]').value);
      const fileInput = form.querySelector('[name="statusMediaFile"]');
      if (fileInput.files[0]) formData.append('file', fileInput.files[0]);
      else formData.append('mediaPath', form.querySelector('[name="statusMediaPath"]').value);
      formData.append('isGif', form.querySelector('[name="statusIsGif"]').checked);
      formData.append('isAudio', form.querySelector('[name="statusIsAudio"]').checked);
    } else if (type === 'revokeStatus') {
      formData.append('revokeMessageId', form.querySelector('[name="revokeMessageId"]').value);
    }

    if (!isRecurring) {
      formData.append('timestamp', new Date(form.querySelector('[name="datetime"]').value).getTime());
    } else {
      formData.append('recurrenceType', document.getElementById('schedule-recurrence-type').value);
      formData.append('recurrenceTime', form.querySelector('[name="recurrenceTime"]').value);
      const dow = Array.from(document.querySelectorAll('.planner-dow:checked')).map(cb => cb.value).join(',');
      if (dow) formData.append('recurrenceDaysOfWeek', dow);
      formData.append('recurrenceDayOfMonth', form.querySelector('[name="recurrenceDayOfMonth"]').value);
    }

    try {
      const res = await fetch(`/whatsapp-manager/api/schedules/${clientId}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        showToast('Evento programado exitosamente');
        toggleModal('schedule-modal', false);
        if (state.calendarInstance) state.calendarInstance.refetchEvents();
      } else {
        showToast(data.error || 'Error en la formulación de ejecución', 'error');
      }
    } catch(err) {
      showToast('Error de red', 'error');
    } finally {
      btn.innerHTML = originalText; btn.disabled = false;
    }
  });

  document.getElementById('btn-execute-bulk')?.addEventListener('click', async () => {
    const clientId = document.getElementById('planner-client-select').value;
    const val = document.getElementById('bulk-import-data').value;
    
    let items;
    try {
      items = JSON.parse(val);
      if(!Array.isArray(items)) throw new Error('La raíz debe ser un array JSON');
    } catch(e) {
      return showToast('Estructura JSON inválida', 'error');
    }

    const btn = document.getElementById('btn-execute-bulk');
    btn.disabled = true;

    try {
      const res = await fetch(`/whatsapp-manager/api/schedules/${clientId}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Se importaron ${data.count} eventos cronológicos`);
        toggleModal('bulk-import-modal', false);
        document.getElementById('bulk-import-data').value = '';
        if (state.calendarInstance) state.calendarInstance.refetchEvents();
      } else {
        showToast(data.error, 'error');
      }
    } catch(err) {
      showToast('Error en la importación', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  let currentViewingSchedule = null;
  function openViewSchedule(schedule) {
    currentViewingSchedule = schedule;
    
    const cleanSchedule = { ...schedule };
    const views = cleanSchedule.viewsCount;
    delete cleanSchedule.viewsCount;
    delete cleanSchedule.lastRunAt;
    delete cleanSchedule.createdAt;
    
    document.getElementById('view-schedule-payload').textContent = JSON.stringify(cleanSchedule, null, 2);
    
    const viewsContainer = document.getElementById('view-schedule-views-container');
    if (views !== undefined && views !== null && (schedule.type === 'postTextStatus' || schedule.type === 'postMediaStatus')) {
        viewsContainer.classList.remove('hidden');
        document.getElementById('view-schedule-views-count').textContent = views;
    } else {
        viewsContainer.classList.add('hidden');
    }
    
    toggleModal('view-schedule-modal', true);
  }

  document.getElementById('btn-delete-schedule')?.addEventListener('click', async () => {
    if(!currentViewingSchedule) return;
    const clientId = document.getElementById('planner-client-select').value;
    try {
      const res = await fetch(`/whatsapp-manager/api/schedules/${clientId}/${currentViewingSchedule.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Evento eliminado del cronograma');
        toggleModal('view-schedule-modal', false);
        if (state.calendarInstance) state.calendarInstance.refetchEvents();
      } else {
        showToast('Rechazo de eliminación', 'error');
      }
    } catch(e) { showToast('Caída de red', 'error'); }
  });

  /* --- General Utils & Modals --- */

  function toggleModal(id, show) {
    const modal = document.getElementById(id);
    const content = document.getElementById(`${id}-content`);
    if(!modal) return;
    if (show) {
      modal.classList.remove('hidden');
      requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
      });
    } else {
      modal.classList.add('opacity-0');
      content.classList.remove('scale-100');
      content.classList.add('scale-95');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  }

  document.body.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'switch-tab') switchTab(actionBtn.dataset.target);
      
      if (action === 'open-schedule-modal') {
        if (!document.getElementById('planner-client-select').value) return showToast('Seleccione una instancia primero', 'error');
        toggleModal('schedule-modal', true);
      }
      if (action === 'close-schedule-modal') toggleModal('schedule-modal', false);
      
      if (action === 'open-bulk-modal') {
        if (!document.getElementById('planner-client-select').value) return showToast('Seleccione una instancia primero', 'error');
        toggleModal('bulk-import-modal', true);
      }
      if (action === 'close-bulk-modal') toggleModal('bulk-import-modal', false);
      if (action === 'close-view-schedule-modal') toggleModal('view-schedule-modal', false);

      if (action === 'toggle-actions') {
        const panel = document.getElementById(`actions-${actionBtn.dataset.client}`);
        if (panel) panel.classList.toggle('hidden');
      }
      if (action === 'open-modal') {
        toggleModal('commands-modal', true);
        document.getElementById('modal-client-id').value = actionBtn.dataset.client;
        const assignedCommands = JSON.parse(actionBtn.dataset.commands || '[]');
        
        const commandsList = document.getElementById('modal-commands-list');
        const automationsList = document.getElementById('modal-automations-list');
        
        const commands = state.modulesMetadata.filter(m => m.type !== 'Automation');
        const automations = state.modulesMetadata.filter(m => m.type === 'Automation');
        
        const renderItem = (mod) => `
          <label class="flex items-start p-4 border border-slate-200 rounded-2xl hover:bg-slate-50 cursor-pointer transition-all shadow-sm relative group">
            <input type="checkbox" value="${mod.filename}" class="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 transition-all" ${assignedCommands.includes(mod.filename)?'checked':''}>
            <div class="ml-3">
              <span class="font-extrabold text-sm text-slate-800">${mod.filename}</span>
              <p class="text-[11px] text-slate-500 mt-1 font-medium leading-relaxed">${mod.instructions}</p>
            </div>
          </label>
        `;
        
        commandsList.innerHTML = commands.length ? commands.map(renderItem).join('') : '<p class="text-xs text-slate-400 font-medium">No hay comandos disponibles.</p>';
        automationsList.innerHTML = automations.length ? automations.map(renderItem).join('') : '<p class="text-xs text-slate-400 font-medium">No hay automatizaciones disponibles.</p>';
      }
      if (action === 'close-modal') toggleModal('commands-modal', false);
      
      if (action === 'open-rules-modal') { /* Rule Modal Fetcher implemented elsewhere */ }
      if (action === 'close-rules-modal') toggleModal('rules-modal', false);

      if (action === 'create-file') createEditorFile();
      if (action === 'save-file') saveCurrentEditorFile();
      if (action === 'open-file') openEditorFile(actionBtn.dataset.filename);

      if (action === 'delete-log') {
         fetch(`/whatsapp-manager/api/logs/${actionBtn.dataset.id}`, { method: 'DELETE' })
         .then(r => r.json())
         .then(d => { if(d.success) loadApiLogs(); })
         .catch(()=>{});
      }
    }
    
    if (e.target.classList.contains('qa-tab-btn')) {
      const parent = e.target.closest('.p-5');
      parent.querySelectorAll('.qa-tab-btn').forEach(b => {
         b.classList.remove('text-indigo-700', 'border-indigo-700');
         b.classList.add('text-slate-500', 'border-transparent');
      });
      e.target.classList.remove('text-slate-500', 'border-transparent');
      e.target.classList.add('text-indigo-700', 'border-indigo-700');
      
      parent.querySelectorAll('.qa-tab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById(e.target.dataset.target).classList.remove('hidden');
    }
  });

  document.body.addEventListener('submit', async (e) => {
    if (e.target.classList.contains('send-message-form') && e.target.id.startsWith('qa-msg-')) {
      e.preventDefault();
      const form = e.target;
      const clientId = form.dataset.clientId;
      const payload = {
        chatId: form.querySelector('[name="chatId"]').value,
        message: form.querySelector('[name="message"]').value
      };
      
      const btn = form.querySelector('button[type="submit"]');
      const ogText = btn.innerHTML;
      btn.innerHTML = 'Enviando...'; btn.disabled = true;

      try {
        const res = await fetch(`/whatsapp-manager/bot/send/${clientId}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) { showToast('¡Mensaje Enviado!'); form.reset(); }
        else { showToast(data.error || 'Fallo', 'error'); }
      } catch(err) { showToast('Error de Red', 'error'); }
      finally { btn.innerHTML = ogText; btn.disabled = false; }
    }
    
    if (e.target.classList.contains('post-status-form')) {
      e.preventDefault();
      const form = e.target;
      const clientId = form.dataset.clientId;
      const type = form.querySelector('.qa-status-type').value;
      
      const formData = new FormData();
      formData.append('statusType', type);
      
      if (type === 'text') {
        const textVal = form.querySelector('[name="statusText"]').value;
        if (!textVal || textVal.trim() === '') return showToast('El texto del estado no puede estar vacío', 'error');
        formData.append('statusText', textVal);
        formData.append('backgroundColor', form.querySelector('[name="backgroundColor"]').value);
        formData.append('fontStyle', form.querySelector('[name="fontStyle"]').value);
      } else {
        const fileInput = form.querySelector('.qa-media-file');
        if (!fileInput.files[0]) return showToast('Archivo multimedia requerido', 'error');
        formData.append('file', fileInput.files[0]);
        formData.append('caption', form.querySelector('[name="caption"]').value);
      }

      const btn = form.querySelector('button[type="submit"]');
      const ogText = btn.innerHTML;
      btn.innerHTML = 'Publicando...'; btn.disabled = true;

      try {
        const res = await fetch(`/whatsapp-manager/bot/status/${clientId}`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if(data.success) { 
           showToast('¡Estado publicado exitosamente!'); 
           form.reset(); 
           const textPre = form.querySelector('.qa-text-preview');
           if (textPre) { textPre.textContent = 'Vista Previa'; textPre.style.backgroundColor = '#eb0c0c'; textPre.style.fontFamily = 'sans-serif'; textPre.style.fontWeight = 'normal'; }
           const mediaPre = form.querySelector('.media-preview-container');
           if (mediaPre) { mediaPre.classList.add('hidden'); }
        }
        else { showToast(data.error || 'Fallo', 'error'); }
      } catch(err) { showToast('Error de Red', 'error'); }
      finally { btn.innerHTML = ogText; btn.disabled = false; }
    }
  });

  document.body.addEventListener('change', (e) => {
    if (e.target.classList.contains('qa-status-type')) {
       const form = e.target.closest('form');
       const isText = e.target.value === 'text';
       form.querySelector('.qa-status-text-fields').classList.toggle('hidden', !isText);
       form.querySelector('.qa-status-media-fields').classList.toggle('hidden', isText);
       form.querySelector('[name="statusText"]').required = isText;
       form.querySelector('.qa-media-file').required = !isText;
    }

    if (e.target.type === 'file' && (e.target.classList.contains('qa-media-file') || e.target.classList.contains('planner-media-file'))) {
      const file = e.target.files[0];
      const previewContainer = e.target.closest('div').parentElement.querySelector('.media-preview-container');
      if (!previewContainer) return;
      const img = previewContainer.querySelector('img');
      const video = previewContainer.querySelector('video');
      
      if (!file) {
         previewContainer.classList.add('hidden');
         return;
      }
      
      previewContainer.classList.remove('hidden');
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
         img.classList.add('hidden');
         video.classList.remove('hidden');
         video.src = url;
      } else {
         video.classList.add('hidden');
         img.classList.remove('hidden');
         img.src = url;
      }
    }
  });

  document.body.addEventListener('input', (e) => {
    if (e.target.classList.contains('qa-preview-trigger') || e.target.classList.contains('status-preview-trigger')) {
       const form = e.target.closest('div').parentElement;
       const textInput = form.querySelector('[name="statusText"]');
       const bgInput = form.querySelector('[name="backgroundColor"]');
       const fontInput = form.querySelector('[name="fontStyle"]');
       
       if (!textInput || !bgInput || !fontInput) return;
       
       const preview = form.querySelector('.qa-text-preview') || form.querySelector('.status-text-preview');
       if (!preview) return;

       preview.textContent = textInput.value || 'Texto de Vista Previa';
       preview.style.backgroundColor = bgInput.value;
       
       const fontVal = parseInt(fontInput.value, 10);
       const styles = ['sans-serif', 'sans-serif', 'cursive', 'sans-serif', 'serif', 'serif', 'sans-serif', 'monospace'];
       preview.style.fontFamily = styles[fontVal] || 'sans-serif';
       preview.style.fontWeight = fontVal === 3 ? 'bold' : 'normal';
    }
  });

  document.getElementById('commands-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = document.getElementById('modal-client-id').value;
    const selected = Array.from(e.target.querySelectorAll('input:checked')).map(cb => cb.value);
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Guardando...'; btn.disabled = true;

    const res = await fetch('/whatsapp-manager/bot/set-commands', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({clientId, commandFiles: selected}) });
    if((await res.json()).success) { 
      showToast('Configuración Guardada'); 
      setTimeout(()=>window.location.reload(), 500); 
    } else {
      btn.innerHTML = originalText; btn.disabled = false;
      showToast('Error al guardar configuración', 'error');
    }
  });

  function initEditor() {
    window.require(['vs/editor/editor.main'], function () {
      state.monacoInstance = monaco.editor.create(document.getElementById('monaco-container'), {
        value: "// Seleccione un archivo...", language: 'typescript', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 14
      });
      state.monacoInstance.onDidChangeModelContent(() => { document.getElementById('editor-save-btn').disabled = false; });
    });
  }
  function loadEditorFiles() {
    fetch('/whatsapp-manager/editor/files').then(r=>r.json()).then(d=>{ state.globalFiles = d.files; renderEditorFilesList(state.globalFiles); });
  }
  function renderEditorFilesList(files) {
    const list = document.getElementById('editor-file-list');
    list.innerHTML = files.map(f => `<button data-action="open-file" data-filename="${f}" class="w-full text-left px-4 py-2 text-sm font-medium rounded-xl text-slate-600 hover:bg-slate-100 mb-1 transition-colors">${f}</button>`).join('');
  }
  function openEditorFile(name) {
    fetch(`/whatsapp-manager/editor/file/${name}`).then(r=>r.json()).then(d=>{
      state.currentEditorFile = name; document.getElementById('current-file-name').textContent = name;
      state.monacoInstance.setValue(d.content); document.getElementById('editor-save-btn').disabled = true;
    });
  }
  function saveCurrentEditorFile() {
    const btn = document.getElementById('editor-save-btn'); btn.disabled=true;
    fetch('/whatsapp-manager/editor/file', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({filename: state.currentEditorFile, content: state.monacoInstance.getValue()})})
    .then(r=>r.json()).then(d=> { showToast('Guardado'); btn.disabled=true; });
  }
  function createEditorFile() {
    const name = prompt('Nombre del archivo:');
    if(name) fetch('/whatsapp-manager/editor/file/create', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({filename: name})}).then(r=>r.json()).then(d=>{ showToast('Creado'); loadEditorFiles(); openEditorFile(d.filename); });
  }

  function connectSSE() {
    const source = new EventSource('/whatsapp-manager/bot/qr');
    source.onmessage = function(event) {
      try {
        const { qr, status } = JSON.parse(event.data);
        Object.entries(status).forEach(([client, rawStatus]) => {
          let clientElement = document.getElementById(`client-${client}`);
          if (!clientElement) return;
          const qrElement = document.getElementById(`qr-${client}`);
          const statusBadge = clientElement.querySelector('.client-status');
          const statusIndicator = clientElement.querySelector('.w-2\\.5.h-2\\.5.rounded-full');

          if (qrElement && statusBadge) {
            const qrCode = qr[client];
            if (qrCode) {
              statusBadge.textContent = 'QR Listo'; statusBadge.className = 'client-status px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap bg-blue-50 text-blue-700 border border-blue-200';
              if(statusIndicator) statusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-blue-500';
              qrElement.innerHTML = ''; new QRCode(qrElement, { text: qrCode, width: 150, height: 150 });
            } else if (rawStatus === 'ready') {
              statusBadge.textContent = 'Conectado'; statusBadge.className = 'client-status px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200';
              if(statusIndicator) statusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
              qrElement.innerHTML = '<div class="text-emerald-500 text-sm font-bold animate-pulse">Sesión Activa</div>';
            } else if (rawStatus === 'error') {
              statusBadge.textContent = 'Error Autenticación'; statusBadge.className = 'client-status px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap bg-red-50 text-red-700 border border-red-200';
              if(statusIndicator) statusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
              qrElement.innerHTML = '<div class="text-red-500 text-xs font-bold">Reinicio Requerido</div>';
            }
          }
        });
      } catch (err) {}
    };
    source.onerror = function() { source.close(); setTimeout(connectSSE, 5000); };
  }
  connectSSE();
});