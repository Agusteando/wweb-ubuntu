document.addEventListener('DOMContentLoaded', () => {
  // Application State
  const state = {
    currentEditorFile: null,
    monacoInstance: null,
    globalFiles: [],
    modalActive: false
  };

  // Initialize Data from HTML
  const dataEl = document.getElementById('app-data');
  if (dataEl && dataEl.dataset.commands) {
    try {
      state.globalFiles = JSON.parse(dataEl.dataset.commands);
    } catch (e) {
      console.error('Failed to parse command files data', e);
      state.globalFiles = [];
    }
  }

  // Toast Notification System
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    // Style configurations based on type
    const bgClass = type === 'success' ? 'bg-green-600' : (type === 'error' ? 'bg-red-600' : 'bg-blue-600');
    const icon = type === 'success' 
      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>'
      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>';

    toast.className = `${bgClass} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-auto`;
    toast.innerHTML = `
      <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icon}</svg>
      <span class="text-sm font-medium">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Animate In
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-10', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Animate Out & Remove
    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-10', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Tab Switching
  function switchTab(target) {
    document.getElementById('tab-clients').classList.toggle('hidden', target !== 'clients');
    document.getElementById('tab-editor').classList.toggle('hidden', target !== 'editor');
    
    const clientsBtn = document.getElementById('tab-clients-btn');
    const editorBtn = document.getElementById('tab-editor-btn');

    if (target === 'clients') {
      clientsBtn.className = 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-700 text-white shadow-inner transition-colors';
      editorBtn.className = 'px-4 py-2 rounded-md font-medium text-sm text-indigo-100 hover:bg-indigo-500 hover:text-white transition-colors';
    } else {
      clientsBtn.className = 'px-4 py-2 rounded-md font-medium text-sm text-indigo-100 hover:bg-indigo-500 hover:text-white transition-colors';
      editorBtn.className = 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-700 text-white shadow-inner transition-colors';
      
      // Initialize Monaco lazily if it hasn't been yet
      if (!state.monacoInstance && window.require) {
        initEditor();
        loadEditorFiles();
      }
    }
  }

  // Commands Modal Lifecycle
  const modal = document.getElementById('commands-modal');
  const modalContent = document.getElementById('commands-modal-content');
  const modalList = document.getElementById('modal-checkbox-list');

  function openModal(clientId, assignedCommands) {
    document.getElementById('modal-client-id').value = clientId;
    document.getElementById('modal-client-id-display').textContent = clientId;
    
    modalList.innerHTML = '';
    
    if (state.globalFiles.length === 0) {
      modalList.innerHTML = '<p class="text-sm text-slate-500 italic p-3 bg-slate-50 rounded-lg">No automation files found. Switch to the Code Editor to create your first bot script.</p>';
    } else {
      state.globalFiles.forEach(file => {
        const isChecked = assignedCommands.includes(file) ? 'checked' : '';
        const html = `
          <label class="flex items-center p-3.5 border border-slate-200 rounded-lg hover:bg-indigo-50 hover:border-indigo-200 cursor-pointer transition-all">
            <input type="checkbox" name="commands[]" value="${file}" class="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" ${isChecked}>
            <span class="ml-3 text-sm font-medium text-slate-800">${file}</span>
          </label>
        `;
        modalList.insertAdjacentHTML('beforeend', html);
      });
    }

    modal.classList.remove('hidden');
    // Animate In
    requestAnimationFrame(() => {
      modal.classList.remove('opacity-0');
      modalContent.classList.remove('scale-95');
      modalContent.classList.add('scale-100');
    });
    state.modalActive = true;
  }

  function closeModal() {
    modal.classList.add('opacity-0');
    modalContent.classList.remove('scale-100');
    modalContent.classList.add('scale-95');
    
    setTimeout(() => {
      modal.classList.add('hidden');
      state.modalActive = false;
    }, 300); // Wait for transition
  }

  // --- Event Delegation (The robust way to handle DOM events) ---
  document.body.addEventListener('click', (e) => {
    
    // Tab Switching
    const tabBtn = e.target.closest('[data-action="switch-tab"]');
    if (tabBtn) switchTab(tabBtn.dataset.target);

    // Toggle Actions Panel
    const toggleBtn = e.target.closest('[data-action="toggle-actions"]');
    if (toggleBtn) {
      const panel = document.getElementById(`actions-${toggleBtn.dataset.client}`);
      if (panel) panel.classList.toggle('hidden');
    }

    // Open Modal
    const openModalBtn = e.target.closest('[data-action="open-modal"]');
    if (openModalBtn) {
      const commands = JSON.parse(openModalBtn.dataset.commands || '[]');
      openModal(openModalBtn.dataset.client, commands);
    }

    // Close Modal
    const closeModalBtn = e.target.closest('[data-action="close-modal"]');
    if (closeModalBtn) closeModal();
    
    // Close Modal on Backdrop Click
    if (e.target === modal) closeModal();

    // Editor: Create File
    const createFileBtn = e.target.closest('[data-action="create-file"]');
    if (createFileBtn) createEditorFile();

    // Editor: Save File
    const saveBtn = e.target.closest('[data-action="save-file"]');
    if (saveBtn) saveCurrentEditorFile();

    // Editor: Open File (Dynamically rendered buttons)
    const openFileBtn = e.target.closest('[data-action="open-file"]');
    if (openFileBtn) openEditorFile(openFileBtn.dataset.filename, openFileBtn);
  });

  // Handle Form Submissions via Delegation
  document.body.addEventListener('submit', async (e) => {
    
    // Handle Save Commands (Modal)
    if (e.target.id === 'commands-form') {
      e.preventDefault();
      const form = e.target;
      const clientId = document.getElementById('modal-client-id').value;
      const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
      const selectedCommands = Array.from(checkboxes).map(cb => cb.value);

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner spinner-dark w-4 h-4 mr-2 border-white border-top-transparent"></span> Saving...';
      btn.disabled = true;

      try {
        const res = await fetch('/whatsapp-manager/bot/set-commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, commandFiles: selectedCommands })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Automations assigned successfully!');
          closeModal();
          setTimeout(() => window.location.reload(), 1000); // Refresh to update UI cleanly
        } else {
          showToast(data.error || 'Failed to assign automations', 'error');
        }
      } catch (err) {
        showToast('Network error while saving', 'error');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }

    // Handle Send Message Form
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
          showToast('Message dispatched successfully');
          form.querySelector('input[name="message"]').value = ''; // Clear message input
        } else {
          showToast(`Error: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast('Failed to connect to server', 'error');
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  });


  // --- Code Editor Implementation ---

  function initEditor() {
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

      // Enable save button only when code changes
      state.monacoInstance.onDidChangeModelContent(() => {
        if (state.currentEditorFile) {
          document.getElementById('editor-save-btn').disabled = false;
        }
      });
    });
  }

  function renderEditorFilesList(files) {
    const list = document.getElementById('editor-file-list');
    list.innerHTML = '';
    
    if (files.length === 0) {
      list.innerHTML = '<p class="text-xs text-slate-400 p-2 italic text-center">No files yet.</p>';
      return;
    }

    files.forEach(file => {
      const isActive = file === state.currentEditorFile;
      const btnClass = isActive 
        ? 'w-full text-left px-3 py-2 text-sm rounded mb-1 transition-colors flex items-center bg-indigo-100 text-indigo-800 font-semibold'
        : 'w-full text-left px-3 py-2 text-sm rounded mb-1 transition-colors flex items-center text-slate-700 hover:bg-slate-100';
      
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
      .catch(err => showToast('Failed to load files list', 'error'));
  }

  function openEditorFile(filename) {
    fetch(`/whatsapp-manager/editor/file/${filename}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          state.currentEditorFile = filename;
          document.getElementById('current-file-name').textContent = filename;
          state.monacoInstance.setValue(data.content);
          document.getElementById('editor-save-btn').disabled = true;
          // Re-render list to show active state
          renderEditorFilesList(state.globalFiles);
        } else {
          showToast('Failed to read file contents', 'error');
        }
      });
  }

  async function saveCurrentEditorFile() {
    if (!state.currentEditorFile || !state.monacoInstance) return;
    
    const content = state.monacoInstance.getValue();
    const btn = document.getElementById('editor-save-btn');
    
    btn.innerHTML = '<span class="spinner spinner-dark w-4 h-4 mr-1 border-white border-top-transparent"></span> Saving...';
    btn.disabled = true;
    
    try {
      const res = await fetch('/whatsapp-manager/editor/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: state.currentEditorFile, content })
      });
      const data = await res.json();
      
      if (data.success) {
        showToast('Code saved and reloaded automatically!');
        btn.innerHTML = '<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Saved';
        setTimeout(() => {
          btn.innerHTML = '<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Save Code';
          // Disabled until next change
          btn.disabled = true; 
        }, 2000);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast(err.message || 'Error saving file', 'error');
      btn.innerHTML = '<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Save Code';
      btn.disabled = false;
    }
  }

  function createEditorFile() {
    const filename = prompt('Enter new automation script name (e.g., SalesBot.ts):');
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
        showToast('Failed to create file: ' + data.error, 'error');
      }
    });
  }

  // Keyboard shortcut for saving Code
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const editorTabActive = !document.getElementById('tab-editor').classList.contains('hidden');
      if (editorTabActive && state.currentEditorFile) {
        e.preventDefault();
        saveCurrentEditorFile();
      }
    }
  });


  // --- Server-Sent Events (SSE) for Realtime Updates ---
  
  function connectSSE() {
    const source = new EventSource('/whatsapp-manager/bot/qr');
    
    source.onmessage = function(event) {
      try {
        const { qr, status } = JSON.parse(event.data);

        Object.entries(status).forEach(([client, rawStatus]) => {
          let clientElement = document.getElementById(`client-${client}`);
          
          // If a new client was injected via backend but isn't in DOM, reload is safest
          if (!clientElement && rawStatus !== 'pending') {
             // Optional: window.location.reload(); 
             // We skip auto-reloading here to avoid interrupting user activity. 
             return; 
          }

          if (clientElement) {
            const qrElement = document.getElementById(`qr-${client}`);
            const statusBadge = clientElement.querySelector('.client-status');

            if (qrElement && statusBadge) {
              const qrCode = qr[client];
              let displayStatus = 'Awaiting QR';
              let badgeClass = 'bg-yellow-100 text-yellow-700';

              if (qrCode) {
                displayStatus = 'QR Received';
                badgeClass = 'bg-blue-100 text-blue-700';
                qrElement.innerHTML = '';
                try {
                  new QRCode(qrElement, { 
                    text: qrCode, width: 160, height: 160, 
                    colorDark: "#1e293b", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H 
                  });
                } catch (err) {}
              } else if (rawStatus === 'ready') {
                displayStatus = 'Connected';
                badgeClass = 'bg-green-100 text-green-700';
                qrElement.innerHTML = '<div class="flex flex-col items-center animate-pulse"><svg class="w-20 h-20 text-green-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span class="text-sm font-bold text-slate-500">Session Active</span></div>';
              } else if (rawStatus === 'error') {
                displayStatus = 'Error';
                badgeClass = 'bg-red-100 text-red-700';
                qrElement.innerHTML = '<div class="flex flex-col items-center"><svg class="w-16 h-16 text-red-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg><span class="text-xs font-bold text-slate-500">Authentication Failed</span></div>';
              } else {
                qrElement.innerHTML = '<div class="flex flex-col items-center"><div class="spinner spinner-dark mb-3"></div><span class="text-xs font-medium text-slate-400">Initializing...</span></div>';
              }

              statusBadge.textContent = displayStatus;
              statusBadge.className = `client-status px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${badgeClass}`;
            }
          }
        });
      } catch (err) {
        console.error("SSE Parsing error", err);
      }
    };

    source.onerror = function() {
      console.warn("SSE connection lost. Reconnecting in 5s...");
      source.close();
      setTimeout(connectSSE, 5000);
    };
  }

  // Init SSE
  connectSSE();
});