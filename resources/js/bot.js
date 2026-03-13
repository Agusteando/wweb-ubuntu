let currentEditorFile = null;
let monacoEditorInstance = null;

document.addEventListener('DOMContentLoaded', function() {
  
  // Tab Switching Logic
  window.switchTab = function(tab) {
    document.getElementById('tab-clients').classList.toggle('hidden', tab !== 'clients');
    document.getElementById('tab-editor').classList.toggle('hidden', tab !== 'editor');
    
    document.getElementById('tab-clients-btn').className = tab === 'clients' 
      ? 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-700 text-white transition-colors' 
      : 'px-4 py-2 rounded-md font-medium text-sm text-indigo-100 hover:bg-indigo-500 transition-colors';
      
    document.getElementById('tab-editor-btn').className = tab === 'editor' 
      ? 'px-4 py-2 rounded-md font-medium text-sm bg-indigo-700 text-white transition-colors' 
      : 'px-4 py-2 rounded-md font-medium text-sm text-indigo-100 hover:bg-indigo-500 transition-colors';

    if (tab === 'editor' && !monacoEditorInstance) {
      initEditor();
      loadEditorFiles();
    }
  };

  // --- Clients Manager Logic ---

  window.toggleActions = function(clientId) {
    const panel = document.getElementById(`actions-${clientId}`);
    if(panel) panel.classList.toggle('hidden');
  };

  document.querySelectorAll('.send-message-form').forEach(form => {
    form.onsubmit = function(e) {
      e.preventDefault();
      const clientId = this.dataset.clientId;
      const chatId = this.querySelector('input[name="chatId"]').value;
      const message = this.querySelector('input[name="message"]').value;
      if (!chatId || !message) {
        alert('Please enter both Chat ID and Message');
        return;
      }
      
      const formData = new URLSearchParams();
      formData.append('chatId', chatId);
      formData.append('message', message);

      fetch(`/whatsapp-manager/bot/send/${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      })
      .then(res => res.json())
      .then(data => {
        if(data.success) alert('Message sent successfully!');
        else alert('Error: ' + data.error);
      })
      .catch(err => alert('Failed to send message: ' + err.message));
    };
  });

  // Modal Logic for Checkboxes
  const modal = document.getElementById('commands-modal');
  const modalList = document.getElementById('modal-checkbox-list');
  const modalClientId = document.getElementById('modal-client-id');
  const modalClientIdDisplay = document.getElementById('modal-client-id-display');
  const commandsForm = document.getElementById('commands-form');

  window.openCommandsModal = function(clientId, assignedCommands) {
    modalClientId.value = clientId;
    modalClientIdDisplay.textContent = clientId;
    
    modalList.innerHTML = '';
    const allFiles = window.GLOBAL_COMMAND_FILES || [];
    
    if (allFiles.length === 0) {
      modalList.innerHTML = '<p class="text-sm text-slate-500 italic">No automation files found in app/Whatsapp/Commands. Go to the Code Editor to create one.</p>';
    }

    allFiles.forEach(file => {
      const isChecked = assignedCommands.includes(file) ? 'checked' : '';
      const html = `
        <label class="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
          <input type="checkbox" name="commands[]" value="${file}" class="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" ${isChecked}>
          <span class="ml-3 text-sm font-medium text-slate-700">${file}</span>
        </label>
      `;
      modalList.insertAdjacentHTML('beforeend', html);
    });

    modal.classList.remove('hidden');
  };

  window.closeCommandsModal = function() {
    modal.classList.add('hidden');
  };

  commandsForm.onsubmit = function(e) {
    e.preventDefault();
    const clientId = modalClientId.value;
    const checkboxes = modalList.querySelectorAll('input[type="checkbox"]:checked');
    const selectedCommands = Array.from(checkboxes).map(cb => cb.value);

    fetch('/whatsapp-manager/bot/set-commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, commandFiles: selectedCommands })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        closeCommandsModal();
        window.location.reload(); // Quick refresh to update UI badges
      }
    });
  };

  // SSE for QR and Status updates
  const source = new EventSource('/whatsapp-manager/bot/qr');
  source.onmessage = function(event) {
    const { qr, status } = JSON.parse(event.data);

    Object.entries(status).forEach(([client, rawStatus]) => {
      let clientElement = document.getElementById(`client-${client}`);
      if (!clientElement) return; 

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
            new QRCode(qrElement, { text: qrCode, width: 150, height: 150, colorDark: "#0f172a", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });
          } catch (err) {}
        } else if (rawStatus === 'ready') {
          displayStatus = 'Connected';
          badgeClass = 'bg-green-100 text-green-700';
          qrElement.innerHTML = '<svg class="w-20 h-20 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        } else if (rawStatus === 'error') {
          displayStatus = 'Error';
          badgeClass = 'bg-red-100 text-red-700';
          qrElement.innerHTML = '<svg class="w-20 h-20 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        } else {
          qrElement.innerHTML = '<div class="spinner border-indigo-500 border-top-transparent"></div>';
        }

        statusBadge.textContent = displayStatus;
        statusBadge.className = `client-status px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${badgeClass}`;
      }
    });
  };


  // --- Code Editor Logic ---
  
  function initEditor() {
    monacoEditorInstance = monaco.editor.create(document.getElementById('monaco-container'), {
      value: "// Select or create a file to start editing...",
      language: 'typescript',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      padding: { top: 16 }
    });

    monacoEditorInstance.onDidChangeModelContent(() => {
      if (currentEditorFile) document.getElementById('editor-save-btn').disabled = false;
    });
  }

  function loadEditorFiles() {
    fetch('/whatsapp-manager/editor/files')
      .then(res => res.json())
      .then(data => {
        const list = document.getElementById('editor-file-list');
        list.innerHTML = '';
        window.GLOBAL_COMMAND_FILES = data.files; // Update global
        
        data.files.forEach(file => {
          const btn = document.createElement('button');
          btn.className = 'w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded mb-1 transition-colors flex items-center';
          btn.innerHTML = `<svg class="w-4 h-4 mr-2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>${file}`;
          btn.onclick = () => openFile(file, btn);
          list.appendChild(btn);
        });
      });
  }

  function openFile(filename, btnElement) {
    document.querySelectorAll('#editor-file-list button').forEach(b => b.classList.remove('bg-indigo-100', 'text-indigo-800', 'font-semibold'));
    if (btnElement) btnElement.classList.add('bg-indigo-100', 'text-indigo-800', 'font-semibold');

    fetch(`/whatsapp-manager/editor/file/${filename}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          currentEditorFile = filename;
          document.getElementById('current-file-name').textContent = filename;
          monacoEditorInstance.setValue(data.content);
          document.getElementById('editor-save-btn').disabled = true;
        }
      });
  }

  window.saveCurrentFile = function() {
    if (!currentEditorFile) return;
    
    const content = monacoEditorInstance.getValue();
    const btn = document.getElementById('editor-save-btn');
    btn.textContent = 'Saving...';
    
    fetch('/whatsapp-manager/editor/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: currentEditorFile, content })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        btn.textContent = 'Saved!';
        btn.disabled = true;
        setTimeout(() => btn.textContent = 'Save Code', 2000);
      } else {
        alert('Failed to save file: ' + data.error);
        btn.textContent = 'Save Code';
      }
    });
  };

  window.createNewFile = function() {
    const filename = prompt('Enter new command filename (e.g., MyCommand.ts):');
    if (!filename) return;

    fetch('/whatsapp-manager/editor/file/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        loadEditorFiles();
        setTimeout(() => openFile(data.filename), 500);
      } else {
        alert('Failed to create file: ' + data.error);
      }
    });
  };

  // Keyboard shortcut for saving
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && !document.getElementById('tab-editor').classList.contains('hidden')) {
      e.preventDefault();
      saveCurrentFile();
    }
  });

});