import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Application from '@ioc:Adonis/Core/Application'
import type BotService from 'App/Services/BotService'
import { v4 as uuidv4 } from 'uuid'

export default class BotController {
  // Always fetch the initialized singleton instance from the IoC container
  private get botService(): BotService {
    return Application.container.use('App/Services/BotService') as BotService
  }

  public async add({ request, response }: HttpContextContract) {
    let clientId = request.input('clientId')
    if (!clientId || clientId.trim() === '') {
      clientId = uuidv4()
    }
    this.botService.addClient(clientId)
    return response.redirect().toPath('/')
  }

  public async setCommand({ request, response }: HttpContextContract) {
    const clientId = request.input('clientId')
    const commandFile = request.input('commandFile')
    
    try {
      await this.botService.setCommandFile(clientId, commandFile)
      return response.status(200).send('Command set successfully')
    } catch (error) {
      return response.status(500).send(error.message)
    }
  }

  public async remove({ request, response }: HttpContextContract) {
    const clientId = request.input('clientId')
    await this.botService.removeClient(clientId)
    return response.redirect().toPath('/')
  }

  public async sendMessage({ request, response, params }: HttpContextContract) {
    const clientId = params.clientId
    const chatId = request.input('chatId')
    const message = request.input('message')
    
    try {
      const result = await this.botService.sendMessage(clientId, chatId, message)
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
      'Access-Control-Allow-Origin': '*',
    })

    const sendUpdate = () => {
      // Safely access state from the running singleton instance
      const data = {
        qr: Object.fromEntries(this.botService.qrCodes),
        status: Object.fromEntries(this.botService.statuses),
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    sendUpdate()
    const interval = setInterval(sendUpdate, 2000)

    // Defensively attach the close event exclusively to the correct Adonis raw request property
    if (request.request && typeof request.request.on === 'function') {
      request.request.on('close', () => {
        clearInterval(interval)
      })
    } else {
      // Fallback cleanup if the Node stream emitter is inaccessible
      setTimeout(() => clearInterval(interval), 600000) // Force clearing after 10 mins
    }
  }
}