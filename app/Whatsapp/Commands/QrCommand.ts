import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import * as QRCode from 'qrcode'

export default class QrCommand {
  public type = 'Command'
  public instructions = '!qr (Responda a un mensaje con un enlace) - Genera un QR en PNG de alta calidad.'

  private extractFirstLink(text: string): string | null {
    const match = text.match(/\b((?:https?:\/\/|www\.)[^\s<>"']+)/i)
    if (!match || !match[1]) return null

    const rawUrl = match[1].replace(/[),.;!?\]}>"']+$/g, '')
    const normalizedUrl = rawUrl.toLowerCase().startsWith('www.') ? `https://${rawUrl}` : rawUrl

    try {
      const parsedUrl = new URL(normalizedUrl)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return null
      return parsedUrl.toString()
    } catch (_error) {
      return null
    }
  }

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!qr') return

    if (!message.hasQuotedMsg) {
      await message.reply('Responde a un mensaje que contenga un enlace y escribe `!qr`.')
      return
    }

    const quotedMsg = await message.getQuotedMessage()
    const quotedText = quotedMsg.body || ''
    const link = this.extractFirstLink(quotedText)

    if (!link) {
      await message.reply('El mensaje citado no contiene un enlace válido con http://, https:// o www.')
      return
    }

    try {
      const qrBuffer = await QRCode.toBuffer(link, {
        errorCorrectionLevel: 'H',
        width: 1024,
        margin: 3,
        color: {
          dark: '#111827',
          light: '#FFFFFF'
        }
      })

      const qrMedia = new MessageMedia('image/png', qrBuffer.toString('base64'), 'qr-link.png')
      await message.reply(qrMedia, undefined, { caption: `QR generado para:\n${link}` })
    } catch (error) {
      console.error('Error generating QR:', error)
      await message.reply('No se pudo generar el QR para ese enlace.')
    }
  }
}
