document.addEventListener('DOMContentLoaded', function() {
  const addForm = document.getElementById('add-client-form')
  const addBtn = document.getElementById('add-btn')
  const generateBtn = document.getElementById('generate-btn')
  const clientList = document.getElementById('client-list')
  let isAdding = false

  function generateClient() {
    if (isAdding) return
    isAdding = true
    disableUI()
    addForm.submit()
  }

  function disableUI() {
    addBtn.disabled = true
    generateBtn.disabled = true
  }

  function enableUI() {
    isAdding = false
    addBtn.disabled = false
    generateBtn.disabled = false
  }

  addForm.onsubmit = function(e) {
    if (isAdding) e.preventDefault()
    isAdding = true
    disableUI()
  }

  generateBtn.onclick = generateClient

  function setCommand(selectElement, clientId) {
    const commandFile = selectElement.value
    const formData = new URLSearchParams()
    formData.append('clientId', clientId)
    formData.append('commandFile', commandFile)

    fetch('/whatsapp-manager/bot/set-command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    }).catch(err => {
      console.error('Error setting command:', err)
      selectElement.value = ''
    })
  }

  window.setCommand = setCommand

  document.querySelectorAll('.set-command-form select').forEach(select => {
    select.onchange = function() {
      const clientId = this.closest('form').dataset.clientId
      setCommand(this, clientId)
    }
  })

  function toggleActions(clientId) {
    const panel = document.getElementById(`actions-${clientId}`)
    if(panel) panel.classList.toggle('active')
  }
  window.toggleActions = toggleActions

  function sendMessage(clientId, chatId, message) {
    const formData = new URLSearchParams()
    formData.append('chatId', chatId)
    formData.append('message', message)

    fetch(`/whatsapp-manager/bot/send/${clientId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    })
    .then(response => {
      if (!response.ok) throw new Error('Failed to send message')
      return response.json()
    })
    .then(() => alert('Message sent successfully!'))
    .catch(err => alert('Failed to send message: ' + err.message))
  }

  document.querySelectorAll('.send-message-form').forEach(form => {
    form.onsubmit = function(e) {
      e.preventDefault()
      const clientId = this.dataset.clientId
      const chatId = this.querySelector('input[name="chatId"]').value
      const message = this.querySelector('input[name="message"]').value
      if (!chatId || !message) {
        alert('Please enter both Chat ID and Message')
        return
      }
      sendMessage(clientId, chatId, message)
    }
  })

  const source = new EventSource('/whatsapp-manager/bot/qr')
  source.onmessage = function(event) {
    const { qr, status } = JSON.parse(event.data)

    Object.entries(status).forEach(([client, rawStatus]) => {
      let clientElement = document.getElementById(`client-${client}`)
      if (!clientElement) {
        // Render new row if generated out of scope
        window.location.reload()
      }

      const qrElement = document.getElementById(`qr-${client}`)
      const statusElement = clientElement.querySelector('.status')

      if (qrElement && statusElement) {
        const qrCode = qr[client]
        let displayStatus = 'Awaiting QR'

        if (qrCode) {
          displayStatus = 'QR Received'
          qrElement.innerHTML = ''
          try {
            new QRCode(qrElement, {
              text: qrCode,
              width: 150,
              height: 150,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            })
          } catch (err) {
            qrElement.innerHTML = '❌ QR Failed'
          }
        } else if (rawStatus === 'ready') {
          displayStatus = 'Connected'
          qrElement.innerHTML = '<span style="color: #00c853; font-size: 1.2em;">✅</span>'
        } else if (rawStatus === 'error') {
          displayStatus = 'Error'
          qrElement.innerHTML = '<span style="color: #e53935; font-size: 1.2em;">❌</span>'
        } else {
          displayStatus = 'Awaiting QR'
          qrElement.innerHTML = '<div class="spinner"></div>'
        }

        statusElement.textContent = displayStatus
        statusElement.className = `status ${displayStatus.toLowerCase().replace(' ', '-')}`
        
        if (rawStatus === 'ready' || rawStatus === 'error') enableUI()
      }
    })
  }

  source.onerror = function() {
    enableUI()
  }
})