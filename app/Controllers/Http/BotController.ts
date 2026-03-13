import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Application from '@ioc:Adonis/Core/Application'
import type BotService from 'App/Services/BotService'

export default class BotController {
  private get botService(): BotService {
    return Application.container.use('App/Services/BotService') as BotService
  }

  public async add({ request, response }: HttpContextContract) {
    let clientId = request.input('clientId') || Math.random().toString(36).substring(7)
    this.botService.addClient(clientId)
    return response.redirect().toPath('/')
  }

  public async remove({ request, response }: HttpContextContract) {
    await this.botService.removeClient(request.input('clientId'))
    return response.redirect().toPath('/')
  }

  public async sendMessage({ request, response, params }: HttpContextContract) {
    try {
      const result = await this.botService.sendMessage(params.clientId, request.input('chatId'), request.input('message'))
      return response.json({ success: true, result })
    } catch (error) {
      return response.status(500).json({ success: false, error: error.message })
    }
  }

  public async sendMedia({ request, response, params }: HttpContextContract) {
    const { chatId, caption, mediaType, source, mimeType, filename } = request.all()
    try {
      const result = await this.botService.sendMedia(params.clientId, chatId, mediaType, source, caption, mimeType, filename)
      return response.json({ success: true, result })
    } catch (error) {
      return response.status(500).json({ success: false, error: error.message })
    }
  }

  public async qr({ request, response }: HttpContextContract) {
    const res = response.response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const interval = setInterval(() => {
      res.write(`data: ${JSON.stringify({
        qr: Object.fromEntries(this.botService.qrCodes),
        status: Object.fromEntries(this.botService.statuses),
      })}\n\n`)
    }, 2000)

    if (request.request && typeof request.request.on === 'function') {
      request.request.on('close', () => clearInterval(interval))
    }
  }
}