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
    setTimeout(() => { toast.classList.remove('translate-y-0', 'opacity-100'); toast.classList.add('translate-y-10', 'opacity-0'); setTimeout(() => toast.remove(), 300); }, 3500);
  }

  function switchTab(target) {
    const tabs = ['clients', 'editor', 'planner', 'analytics'];
    tabs.forEach(t => {
      const el = document.getElementById(`tab-${t}`);
      const btn = document.getElementById(`tab-${t}-btn`);
      if (el && btn) {
        if (t === target) {
          el.classList.remove('hidden');
          btn.className = 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-600 text-white shadow-inner transition-all';
        } else {
          el.classList.add('hidden');
          btn.className = 'px-4 py-2 rounded-md font-medium text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-all';
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
  }

  /* --- Analytics Visualization --- */
  
  function refreshAnalyticsClients() {
    const select = document.getElementById('analytics-client-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select Instance...</option>';
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
      tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-10 text-center text-slate-500 text-sm">Select an instance to view historic status performance</td></tr>';
      return;
    }

    tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-10 text-center text-slate-500"><div class="spinner spinner-dark mx-auto"></div></td></tr>';

    try {
      const res = await fetch(`/whatsapp-manager/api/schedules/${clientId}`);
      const data = await res.json();
      if (!data.success) throw new Error();

      const statuses = data.schedules.filter(s => ['postTextStatus', 'postMediaStatus'].includes(s.type) && s.statusMessageId);
      
      if (statuses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-10 text-center text-slate-500 text-sm">No deployed statuses found with trackable views for this instance.</td></tr>';
        return;
      }

      statuses.sort((a, b) => (b.lastRunAt || b.timestamp || 0) - (a.lastRunAt || a.timestamp || 0));
      const maxViews = Math.max(...statuses.map(s => s.viewsCount || 0), 1);

      tbody.innerHTML = statuses.map(s => {
        const date = new Date(s.lastRunAt || s.timestamp || s.createdAt).toLocaleString();
        const isText = s.type === 'postTextStatus';
        const typeBadge = isText ? '<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">Text</span>' : '<span class="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-semibold">Media</span>';
        
        let preview = '';
        if (isText) {
            preview = `<div class="max-w-xs truncate font-bold px-2 py-1 rounded" style="background-color: ${s.backgroundColor || '#eee'}; color: #fff;">${s.statusText}</div>`;
        } else {
            preview = `<div class="max-w-xs truncate font-medium text-slate-800">${s.caption || '<em>No caption</em>'}</div><div class="text-[10px] text-slate-400 truncate w-48">${s.mediaPath}</div>`;
        }

        const views = s.viewsCount || 0;
        const widthPct = Math.round((views / maxViews) * 100);

        return `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-700">${date}</td>
            <td class="px-6 py-4 whitespace-nowrap">${typeBadge}</td>
            <td class="px-6 py-4">${preview}</td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center gap-3">
                <span class="font-bold text-slate-700 w-8 text-right">${views}</span>
                <div class="w-32 bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div class="bg-emerald-500 h-2.5 rounded-full" style="width: ${widthPct}%"></div>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-10 text-center text-red-500 text-sm">Failed to load analytics data.</td></tr>';
    }
  }


  /* --- Planner & Calendar Initialization --- */

  function refreshPlannerClients() {
    const select = document.getElementById('planner-client-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select Instance...</option>';
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
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listMonth'
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
           if (s.type === 'message') { title = s.message || (s.mediaPath ? 'Media Out' : 'Msg'); color = '#4f46e5'; }
           else if (s.type === 'postTextStatus') { title = `Status: ${s.statusText || 'Text'}`; color = '#059669'; }
           else if (s.type === 'postMediaStatus') { title = `Status: ${s.caption || 'Media'}`; color = '#059669'; }
           else if (s.type === 'revokeStatus') { title = `Revoke Story`; color = '#dc2626'; }
           
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
        c.className = 'schedule-mode-btn flex-1 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 rounded-lg transition-all';
      });
      e.target.className = 'schedule-mode-btn flex-1 py-2 text-sm font-bold bg-white text-indigo-700 shadow-sm rounded-lg transition-all';
      
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

    // Toggle required fields properly so HTML5 validation blocks empty status attempts naturally
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
    container.innerHTML = '<div class="spinner spinner-dark mx-auto my-2"></div>';
    container.classList.remove('hidden');
    try {
      const res = await fetch(`/whatsapp-manager/api/chats/${clientId}`);
      const data = await res.json();
      if (data.success && data.chats.length > 0) {
        container.innerHTML = data.chats.map(c => `
          <label class="flex items-center gap-3 p-2 hover:bg-slate-50 border-b border-slate-100 last:border-0 cursor-pointer transition-colors">
            <input type="checkbox" value="${c.id}" class="planner-chat-cb rounded w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300">
            <div class="flex flex-col overflow-hidden"><span class="text-xs font-bold text-slate-700 truncate w-full" title="${c.name}">${c.name}</span><span class="text-[10px] text-slate-400 font-mono">${c.id}</span></div>
          </label>
        `).join('');
      } else {
        container.innerHTML = '<p class="text-xs font-semibold text-slate-500 p-2">No accessible connections found.</p>';
      }
    } catch (err) {
      container.innerHTML = '<p class="text-xs font-semibold text-red-500 p-2">Failure establishing contact bridge.</p>';
    }
  });

  document.getElementById('btn-save-schedule')?.addEventListener('click', async () => {
    const clientId = document.getElementById('planner-client-select').value;
    const form = document.getElementById('schedule-form');
    
    if(!clientId) return showToast('Client missing.', 'error');
    if(!form.checkValidity()) return form.reportValidity();

    const type = document.getElementById('schedule-type').value;

    // Explicit manual validation to ensure valid non-empty media status payload
    if (type === 'postMediaStatus') {
       const fileInput = form.querySelector('[name="statusMediaFile"]');
       const pathInput = form.querySelector('[name="statusMediaPath"]').value;
       if (!fileInput.files[0] && !pathInput.trim()) {
           return showToast('You must provide a file or URL to post a Media Status.', 'error');
       }
    }

    const btn = document.getElementById('btn-save-schedule');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Locking...'; btn.disabled = true;

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
        showToast('Timeline locked securely');
        toggleModal('schedule-modal', false);
        if (state.calendarInstance) state.calendarInstance.refetchEvents();
      } else {
        showToast(data.error || 'Execution formulation failed', 'error');
      }
    } catch(err) {
      showToast('Network error', 'error');
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
      if(!Array.isArray(items)) throw new Error('Root must be JSON array');
    } catch(e) {
      return showToast('Invalid JSON architecture', 'error');
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
        showToast(`Ingested ${data.count} chronological entities`);
        toggleModal('bulk-import-modal', false);
        document.getElementById('bulk-import-data').value = '';
        if (state.calendarInstance) state.calendarInstance.refetchEvents();
      } else {
        showToast(data.error, 'error');
      }
    } catch(err) {
      showToast('Ingestion dropped', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  let currentViewingSchedule = null;
  function openViewSchedule(schedule) {
    currentViewingSchedule = schedule;
    
    // Cleanup internal keys like lastRunAt, createdAt for cleaner UI viewing
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
        showToast('Entity purged from timeline');
        toggleModal('view-schedule-modal', false);
        if (state.calendarInstance) state.calendarInstance.refetchEvents();
      } else {
        showToast('Purge rejection', 'error');
      }
    } catch(e) { showToast('Network drop', 'error'); }
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

  // Bind Global Clicks
  document.body.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'switch-tab') switchTab(actionBtn.dataset.target);
      
      // Planners Modals
      if (action === 'open-schedule-modal') {
        if (!document.getElementById('planner-client-select').value) return showToast('Attach Instance First', 'error');
        toggleModal('schedule-modal', true);
      }
      if (action === 'close-schedule-modal') toggleModal('schedule-modal', false);
      
      if (action === 'open-bulk-modal') {
        if (!document.getElementById('planner-client-select').value) return showToast('Attach Instance First', 'error');
        toggleModal('bulk-import-modal', true);
      }
      if (action === 'close-bulk-modal') toggleModal('bulk-import-modal', false);
      if (action === 'close-view-schedule-modal') toggleModal('view-schedule-modal', false);

      // Misc
      if (action === 'toggle-actions') {
        const panel = document.getElementById(`actions-${actionBtn.dataset.client}`);
        if (panel) panel.classList.toggle('hidden');
      }
      if (action === 'open-modal') {
        // Core Logic Assigner
        toggleModal('commands-modal', true);
        document.getElementById('modal-client-id').value = actionBtn.dataset.client;
        const commands = JSON.parse(actionBtn.dataset.commands || '[]');
        const list = document.getElementById('modal-checkbox-list');
        list.innerHTML = state.modulesMetadata.map(mod => `
          <label class="flex items-start p-3 border border-slate-200 rounded-xl hover:bg-indigo-50 cursor-pointer">
            <input type="checkbox" value="${mod.filename}" class="w-5 h-5 text-indigo-600 rounded mt-0.5" ${commands.includes(mod.filename)?'checked':''}>
            <div class="ml-3"><span class="font-bold text-sm text-slate-800">${mod.filename}</span><p class="text-xs text-slate-500 mt-1">${mod.instructions}</p></div>
          </label>
        `).join('');
      }
      if (action === 'close-modal') toggleModal('commands-modal', false);
      
      if (action === 'open-rules-modal') { /* Rule Modal Fetcher implemented elsewhere */ }
      if (action === 'close-rules-modal') toggleModal('rules-modal', false);

      // Editor
      if (action === 'create-file') createEditorFile();
      if (action === 'save-file') saveCurrentEditorFile();
      if (action === 'open-file') openEditorFile(actionBtn.dataset.filename);
    }
    
    // Action Tabs UI (Client Quick Actions)
    if (e.target.classList.contains('qa-tab-btn')) {
      const parent = e.target.closest('.p-4');
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

  // Handle Quick Action Dispatching
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
      btn.innerHTML = 'Sending...'; btn.disabled = true;

      try {
        const res = await fetch(`/whatsapp-manager/bot/send/${clientId}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) { showToast('Message Sent!'); form.reset(); }
        else { showToast(data.error || 'Failed', 'error'); }
      } catch(err) { showToast('Network Error', 'error'); }
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
        if (!textVal || textVal.trim() === '') return showToast('Status text cannot be empty', 'error');
        formData.append('statusText', textVal);
        formData.append('backgroundColor', form.querySelector('[name="backgroundColor"]').value);
        formData.append('fontStyle', form.querySelector('[name="fontStyle"]').value);
      } else {
        const fileInput = form.querySelector('.qa-media-file');
        if (!fileInput.files[0]) return showToast('Media file required', 'error');
        formData.append('file', fileInput.files[0]);
        formData.append('caption', form.querySelector('[name="caption"]').value);
      }

      const btn = form.querySelector('button[type="submit"]');
      const ogText = btn.innerHTML;
      btn.innerHTML = 'Posting...'; btn.disabled = true;

      try {
        const res = await fetch(`/whatsapp-manager/bot/status/${clientId}`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if(data.success) { 
           showToast('Status Successfully Broadcasted!'); 
           form.reset(); 
           // trigger event to reset preview rendering
           const textPre = form.querySelector('.qa-text-preview');
           if (textPre) { textPre.textContent = 'Preview'; textPre.style.backgroundColor = '#eb0c0c'; textPre.style.fontFamily = 'sans-serif'; textPre.style.fontWeight = 'normal'; }
           const mediaPre = form.querySelector('.media-preview-container');
           if (mediaPre) { mediaPre.classList.add('hidden'); }
        }
        else { showToast(data.error || 'Failed', 'error'); }
      } catch(err) { showToast('Network Error', 'error'); }
      finally { btn.innerHTML = ogText; btn.disabled = false; }
    }
  });

  // Live Previews and Select toggles for QA Status form & Planner Status form
  document.body.addEventListener('change', (e) => {
    // Media select type toggle (Text vs Image/Video/etc)
    if (e.target.classList.contains('qa-status-type')) {
       const form = e.target.closest('form');
       const isText = e.target.value === 'text';
       form.querySelector('.qa-status-text-fields').classList.toggle('hidden', !isText);
       form.querySelector('.qa-status-media-fields').classList.toggle('hidden', isText);
       form.querySelector('[name="statusText"]').required = isText;
       form.querySelector('.qa-media-file').required = !isText;
    }

    // Media file preview logic
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
    // Text Status live CSS preview
    if (e.target.classList.contains('qa-preview-trigger') || e.target.classList.contains('status-preview-trigger')) {
       const form = e.target.closest('div').parentElement;
       const textInput = form.querySelector('[name="statusText"]');
       const bgInput = form.querySelector('[name="backgroundColor"]');
       const fontInput = form.querySelector('[name="fontStyle"]');
       
       if (!textInput || !bgInput || !fontInput) return;
       
       const preview = form.querySelector('.qa-text-preview') || form.querySelector('.status-text-preview');
       if (!preview) return;

       preview.textContent = textInput.value || 'Preview Text';
       preview.style.backgroundColor = bgInput.value;
       
       const fontVal = parseInt(fontInput.value, 10);
       const styles = ['sans-serif', 'sans-serif', 'cursive', 'sans-serif', 'serif', 'serif', 'sans-serif', 'monospace'];
       preview.style.fontFamily = styles[fontVal] || 'sans-serif';
       preview.style.fontWeight = fontVal === 3 ? 'bold' : 'normal';
    }
  });

  // Handle Logic Assigner forms
  document.getElementById('commands-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = document.getElementById('modal-client-id').value;
    const selected = Array.from(e.target.querySelectorAll('input:checked')).map(cb => cb.value);
    const res = await fetch('/whatsapp-manager/bot/set-commands', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({clientId, commandFiles: selected}) });
    if((await res.json()).success) { showToast('Locked'); setTimeout(()=>window.location.reload(), 500); }
  });

  // Basic Editor implementation structure preserving features...
  function initEditor() {
    window.require(['vs/editor/editor.main'], function () {
      state.monacoInstance = monaco.editor.create(document.getElementById('monaco-container'), {
        value: "// Select a file...", language: 'typescript', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 14
      });
      state.monacoInstance.onDidChangeModelContent(() => { document.getElementById('editor-save-btn').disabled = false; });
    });
  }
  function loadEditorFiles() {
    fetch('/whatsapp-manager/editor/files').then(r=>r.json()).then(d=>{ state.globalFiles = d.files; renderEditorFilesList(state.globalFiles); });
  }
  function renderEditorFilesList(files) {
    const list = document.getElementById('editor-file-list');
    list.innerHTML = files.map(f => `<button data-action="open-file" data-filename="${f}" class="w-full text-left px-3 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 mb-1">${f}</button>`).join('');
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
    .then(r=>r.json()).then(d=> { showToast('Saved'); btn.disabled=true; });
  }
  function createEditorFile() {
    const name = prompt('File name:');
    if(name) fetch('/whatsapp-manager/editor/file/create', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({filename: name})}).then(r=>r.json()).then(d=>{ showToast('Created'); loadEditorFiles(); openEditorFile(d.filename); });
  }

  // SSE SSE Connection mapping...
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
          if (qrElement && statusBadge) {
            const qrCode = qr[client];
            if (qrCode) {
              statusBadge.textContent = 'QR Ready'; statusBadge.className = 'client-status px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700';
              qrElement.innerHTML = ''; new QRCode(qrElement, { text: qrCode, width: 160, height: 160 });
            } else if (rawStatus === 'ready') {
              statusBadge.textContent = 'Connected'; statusBadge.className = 'client-status px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700';
              qrElement.innerHTML = '<div class="text-green-500 text-sm font-bold animate-pulse">Session Active</div>';
            } else if (rawStatus === 'error') {
              statusBadge.textContent = 'Auth Failed'; statusBadge.className = 'client-status px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700';
              qrElement.innerHTML = '<div class="text-red-400 text-xs font-bold">Restart Required</div>';
            }
          }
        });
      } catch (err) {}
    };
    source.onerror = function() { source.close(); setTimeout(connectSSE, 5000); };
  }
  connectSSE();
});