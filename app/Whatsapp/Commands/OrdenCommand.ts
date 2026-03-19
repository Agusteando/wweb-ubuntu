import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import axios from 'axios'

function extractOrdenFromText(s: string): string {
  return (s || '').toString().trim()
}

export default class OrdenCommand {
  public type = 'Command'
  public instructions = '!orden <folio> o responde a un mensaje con el folio y escribe !orden'

  async handle(message: Message, client: Client, _session: UserSession) {
    const body = message.body || ''
    const lowerBody = body.toLowerCase()

    // Accept both !orden and /orden triggers mapping the old Telegram alias mapping
    if (!lowerBody.startsWith('!orden') && !lowerBody.startsWith('/orden')) {
      return
    }

    let orden = ''

    // WhatsApp behavior: Check if quoting/replying to a message
    if (message.hasQuotedMsg) {
      const quotedMsg = await message.getQuotedMessage()
      // Extract from the quoted message's body/caption
      orden = extractOrdenFromText(quotedMsg.body)
    } else {
      // Remove the command text and extract the leftover arguments
      const textWithoutCmd = body.replace(/^(!|\/)orden\b/i, '').trim()
      orden = extractOrdenFromText(textWithoutCmd)
    }

    if (!orden) {
      await message.reply('Uso: !orden <folio>\nO responde a un mensaje con el folio y escribe !orden')
      return
    }

    const url = `https://compras.casitaapps.com/fpdf_orden.php?ver=${encodeURIComponent(orden)}`
    const filename = `${orden}.pdf`

    try {
      const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        validateStatus: () => true // Prevent axios from throwing on non-200 statuses
      })

      if (response.status !== 200) {
        await message.reply(`No se pudo obtener el PDF (HTTP ${response.status}).`)
        return
      }

      const buffer = Buffer.from(response.data, 'binary')

      // Tiny sanity check mapping your original codebase rule
      if (!buffer.length || buffer.length < 100) {
        await message.reply('El PDF recibido está vacío o inválido.')
        return
      }

      const base64Data = buffer.toString('base64')
      const media = new MessageMedia('application/pdf', base64Data, filename)

      // Sends back the document to the chat where it was requested, quoting the command message
      await client.sendMessage(message.from, media, { 
        caption: `Orden: ${orden}`,
        quotedMessageId: message.id._serialized 
      })

    } catch (error: any) {
      console.error('[orden] error:', error)
      await message.reply('Sorry, hubo un error procesando tu solicitud.')
    }
  }
}