console.log('✅ Bot Manager v3.0 Initialized');

document.addEventListener('DOMContentLoaded', () => {
  // Application State
  const state = {
    currentEditorFile: null,
    monacoInstance: null,
    globalFiles: [],
    modalActive: false
  };

  // 1. Safely Parse Data from Server
  try {
    const dataEl = document.getElementById('app-data');
    if (dataEl && dataEl.dataset.commands) {
      state.globalFiles = JSON.parse(dataEl.dataset.commands);
    }
  } catch (e) {
    console.warn('⚠️ Could not parse global commands from HTML.', e);
  }

  // 2. Toast Notification System
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return; // Fail gracefully if DOM is broken
    
    const toast = document.createElement('div');
    const bgClass = type === 'success' ? 'bg-emerald-600' : (type === 'error' ? 'bg-red-600' : 'bg-slate-800');
    const icon = type === 'success' 
      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>'
      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>';

    toast.className = `${bgClass} text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-auto`;
    toast.innerHTML = `
      <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icon}</svg>
      <span class="text-sm font-medium">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-10', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-10', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // 3. Tab Management
  function switchTab(target) {
    const tabClients = document.getElementById('tab-clients');
    const tabEditor = document.getElementById('tab-editor');
    const btnClients = document.getElementById('tab-clients-btn');
    const btnEditor = document.getElementById('tab-editor-btn');

    if (!tabClients || !tabEditor || !btnClients || !btnEditor) return;

    tabClients.classList.toggle('hidden', target !== 'clients');
    tabEditor.classList.toggle('hidden', target !== 'editor');

    if (target === 'clients') {
      btnClients.className = 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-600 text-white shadow-inner transition-all';
      btnEditor.className = 'px-4 py-2 rounded-md font-medium text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-all';
    } else {
      btnClients.className = 'px-4 py-2 rounded-md font-medium text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-all';
      btnEditor.className = 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-600 text-white shadow-inner transition-all';
      
      // Lazy load Monaco Editor
      if (!state.monacoInstance && window.require) {
        initEditor();
        loadEditorFiles();
      }
    }
  }

  // 4. Modal Management
  function openModal(clientId, assignedCommands) {
    const modal = document.getElementById('commands-modal');
    const modalContent = document.getElementById('commands-modal-content');
    const modalList = document.getElementById('modal-checkbox-list');
    
    if (!modal || !modalList) return;

    document.getElementById('modal-client-id').value = clientId;
    document.getElementById('modal-client-id-display').textContent = clientId;
    
    modalList.innerHTML = '';
    
    if (state.globalFiles.length === 0) {
      modalList.innerHTML = '<div class="p-4 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-500 italic text-center">No logic modules found. Use the Logic Editor tab to create one.</div>';
    } else {
      state.globalFiles.forEach(file => {
        const isChecked = assignedCommands.includes(file) ? 'checked' : '';
        const html = `
          <label class="flex items-center p-3.5 border border-slate-200 rounded-xl hover:bg-indigo-50 hover:border-indigo-300 cursor-pointer transition-all">
            <input type="checkbox" name="commands[]" value="${file}" class="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" ${isChecked}>
            <span class="ml-3 text-sm font-medium text-slate-800">${file}</span>
          </label>
        `;
        modalList.insertAdjacentHTML('beforeend', html);
      });
    }

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      modal.classList.remove('opacity-0');
      modalContent.classList.remove('scale-95');
      modalContent.classList.add('scale-100');
    });
    state.modalActive = true;
  }

  function closeModal() {
    const modal = document.getElementById('commands-modal');
    const modalContent = document.getElementById('commands-modal-content');
    if (!modal) return;

    modal.classList.add('opacity-0');
    modalContent.classList.remove('scale-100');
    modalContent.classList.add('scale-95');
    
    setTimeout(() => {
      modal.classList.add('hidden');
      state.modalActive = false;
    }, 300);
  }

  // 5. Global Event Delegation (Bulletproof Click Handlers)
  document.body.addEventListener('click', (e) => {
    // Buttons
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      
      if (action === 'switch-tab') switchTab(actionBtn.dataset.target);
      
      if (action === 'toggle-actions') {
        const panel = document.getElementById(`actions-${actionBtn.dataset.client}`);
        if (panel) panel.classList.toggle('hidden');
      }

      if (action === 'open-modal') {
        const commands = JSON.parse(actionBtn.dataset.commands || '[]');
        openModal(actionBtn.dataset.client, commands);
      }

      if (action === 'close-modal') closeModal();
      if (action === 'create-file') createEditorFile();
      if (action === 'save-file') saveCurrentEditorFile();
      if (action === 'open-file') openEditorFile(actionBtn.dataset.filename);
    }

    // Background Click Close Modal
    if (e.target.id === 'commands-modal') closeModal();
  });

  // 6. Global Form Delegation
  document.body.addEventListener('submit', async (e) => {
    
    // Command Assignment Modal
    if (e.target.id === 'commands-form') {
      e.preventDefault();
      const form = e.target;
      const clientId = document.getElementById('modal-client-id').value;
      const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
      const selectedCommands = Array.from(checkboxes).map(cb => cb.value);

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<div class="spinner spinner-dark w-4 h-4 mr-2 border-white border-top-transparent"></div> Saving...';
      btn.disabled = true;

      try {
        const res = await fetch('/whatsapp-manager/bot/set-commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, commandFiles: selectedCommands })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Configuration applied. Auto-reloading...', 'success');
          closeModal();
          setTimeout(() => window.location.reload(), 1000);
        } else {
          showToast(data.error || 'Failed to update', 'error');
        }
      } catch (err) {
        showToast('Network error while saving', 'error');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }

    // Send Message
    if (e.target.classList.contains('send-message-form')) {
      e.preventDefault();
      const form = e.target;
      const clientId = form.dataset.clientId;
      const chatId = form.querySelector('input[name="chatId"]').value;
      const message = form.querySelector('input[name="message"]').value;
      
      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.textContent = 'Sending...';
      btn.disabled = true;

      const formData = new URLSearchParams();
      formData.append('chatId', chatId);
      formData.append('message', message);

      try {
        const res = await fetch(`/whatsapp-manager/bot/send/${clientId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        });
        const data = await res.json();
        if (data.success) {
          showToast('Message delivered');
          form.querySelector('input[name="message"]').value = '';
        } else {
          showToast(`Error: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast('Connection failed', 'error');
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  });


  // 7. Monaco Editor Logic
  function initEditor() {
    try {
      window.require(['vs/editor/editor.main'], function () {
        state.monacoInstance = monaco.editor.create(document.getElementById('monaco-container'), {
          value: "// Select a file from the sidebar to begin editing...",
          language: 'typescript',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          padding: { top: 20 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
        });

        state.monacoInstance.onDidChangeModelContent(() => {
          if (state.currentEditorFile) {
            document.getElementById('editor-save-btn').disabled = false;
          }
        });
      });
    } catch (e) {
      console.error("Monaco Editor failed to initialize", e);
    }
  }

  function renderEditorFilesList(files) {
    const list = document.getElementById('editor-file-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (files.length === 0) {
      list.innerHTML = '<div class="text-xs text-slate-400 p-3 italic text-center bg-slate-50 rounded-lg border border-slate-100">No logic modules found.</div>';
      return;
    }

    files.forEach(file => {
      const isActive = file === state.currentEditorFile;
      const btnClass = isActive 
        ? 'w-full text-left px-3 py-2.5 text-sm rounded-lg mb-1 transition-all flex items-center bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100'
        : 'w-full text-left px-3 py-2.5 text-sm rounded-lg mb-1 transition-all flex items-center text-slate-600 hover:bg-slate-100 border border-transparent';
      
      const btn = document.createElement('button');
      btn.className = btnClass;
      btn.dataset.action = 'open-file';
      btn.dataset.filename = file;
      btn.innerHTML = `<svg class="w-4 h-4 mr-2 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><span class="truncate">${file}</span>`;
      list.appendChild(btn);
    });
  }

  function loadEditorFiles() {
    fetch('/whatsapp-manager/editor/files')
      .then(res => res.json())
      .then(data => {
        state.globalFiles = data.files || [];
        renderEditorFilesList(state.globalFiles);
      })
      .catch(err => showToast('Failed to sync files', 'error'));
  }

  function openEditorFile(filename) {
    fetch(`/whatsapp-manager/editor/file/${filename}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          state.currentEditorFile = filename;
          document.getElementById('current-file-name').textContent = filename;
          if(state.monacoInstance) state.monacoInstance.setValue(data.content);
          document.getElementById('editor-save-btn').disabled = true;
          renderEditorFilesList(state.globalFiles);
        } else {
          showToast('Failed to read file', 'error');
        }
      });
  }

  async function saveCurrentEditorFile() {
    if (!state.currentEditorFile || !state.monacoInstance) return;
    
    const content = state.monacoInstance.getValue();
    const btn = document.getElementById('editor-save-btn');
    
    btn.innerHTML = '<div class="spinner spinner-dark w-4 h-4 mr-2 border-white border-top-transparent"></div> Saving...';
    btn.disabled = true;
    
    try {
      const res = await fetch('/whatsapp-manager/editor/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: state.currentEditorFile, content })
      });
      const data = await res.json();
      
      if (data.success) {
        showToast('Saved successfully');
        btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Saved';
        setTimeout(() => {
          btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Save & Hot Reload';
          btn.disabled = true; 
        }, 2000);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast(err.message || 'Error saving file', 'error');
      btn.innerHTML = 'Retry Save';
      btn.disabled = false;
    }
  }

  function createEditorFile() {
    const filename = prompt('Enter script name (e.g. SalesBot.ts):');
    if (!filename || filename.trim() === '') return;

    fetch('/whatsapp-manager/editor/file/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename.trim() })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast(`Created ${data.filename}`);
        loadEditorFiles();
        setTimeout(() => openEditorFile(data.filename), 500);
      } else {
        showToast('Failed to create file', 'error');
      }
    });
  }

  // Ctrl+S / Cmd+S Shortcut
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const editorTabActive = !document.getElementById('tab-editor').classList.contains('hidden');
      if (editorTabActive && state.currentEditorFile) {
        e.preventDefault();
        saveCurrentEditorFile();
      }
    }
  });

  // 8. Server-Sent Events (Realtime Status)
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
            let displayStatus = 'Initializing';
            let badgeClass = 'bg-yellow-100 text-yellow-700';

            if (qrCode) {
              displayStatus = 'QR Ready';
              badgeClass = 'bg-blue-100 text-blue-700';
              qrElement.innerHTML = '';
              try {
                new QRCode(qrElement, { 
                  text: qrCode, width: 160, height: 160, 
                  colorDark: "#0f172a", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H 
                });
              } catch (err) {}
            } else if (rawStatus === 'ready') {
              displayStatus = 'Connected';
              badgeClass = 'bg-green-100 text-green-700';
              qrElement.innerHTML = '<div class="flex flex-col items-center animate-pulse"><svg class="w-16 h-16 text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span class="text-sm font-bold text-slate-500">Session Active</span></div>';
            } else if (rawStatus === 'error') {
              displayStatus = 'Auth Failed';
              badgeClass = 'bg-red-100 text-red-700';
              qrElement.innerHTML = '<div class="flex flex-col items-center"><svg class="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg><span class="text-xs font-bold text-slate-500">Restart Required</span></div>';
            } else {
              qrElement.innerHTML = '<div class="flex flex-col items-center"><div class="spinner spinner-dark mb-4"></div><span class="text-xs font-medium text-slate-400 uppercase tracking-wider">Starting Engine...</span></div>';
            }

            statusBadge.textContent = displayStatus;
            statusBadge.className = `client-status px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${badgeClass}`;
          }
        });
      } catch (err) {}
    };

    source.onerror = function() {
      source.close();
      setTimeout(connectSSE, 5000); // Reconnect silently in bg
    };
  }

  connectSSE();
});