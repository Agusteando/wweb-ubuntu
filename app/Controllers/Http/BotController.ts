import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import BotService from '@ioc:App/Services/BotService'
import { v4 as uuidv4 } from 'uuid'

export default class BotController {
  public async add({ request, response }: HttpContextContract) {
    let clientId = request.input('clientId')
    if (!clientId || clientId.trim() === '') {
      clientId = uuidv4()
    }
    BotService.addClient(clientId)
    return response.redirect().toPath('/')
  }

  public async setCommand({ request, response }: HttpContextContract) {
    const clientId = request.input('clientId')
    const commandFile = request.input('commandFile')
    
    try {
      await BotService.setCommandFile(clientId, commandFile)
      return response.status(200).send('Command set successfully')
    } catch (error) {
      return response.status(500).send(error.message)
    }
  }

  public async remove({ request, response }: HttpContextContract) {
    const clientId = request.input('clientId')
    await BotService.removeClient(clientId)
    return response.redirect().toPath('/')
  }

  public async sendMessage({ request, response, params }: HttpContextContract) {
    const clientId = params.clientId
    const chatId = request.input('chatId')
    const message = request.input('message')
    
    try {
      const result = await BotService.sendMessage(clientId, chatId, message)
      return response.json({ success: true, result })
    } catch (error) {
      return response.status(500).json({ success: false, error: error.message })
    }
  }

  public async qr({ response }: HttpContextContract) {
    const res = response.response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const sendUpdate = () => {
      const data = {
        qr: Object.fromEntries(BotService.qrCodes),
        status: Object.fromEntries(BotService.statuses),
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    sendUpdate()
    const interval = setInterval(sendUpdate, 2000)

    response.request.request.on('close', () => {
      clearInterval(interval)
    })
  }
}