import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Application from '@ioc:Adonis/Core/Application'
import type BotService from 'App/Services/BotService'
import CommandRegistry from 'App/Services/CommandRegistry'

export default class BotController {
  private get botService(): BotService {
    return Application.container.use('App/Services/BotService') as BotService
  }

  public async index({ view }: HttpContextContract) {
    const clientsData = Array.from(this.botService.statuses.entries()).map(([clientId, status]) => {
      const config = this.botService.configs.get(clientId)
      return {
        clientId,
        status: this.botService.qrCodes.get(clientId) ? 'QR Received' : (status === 'ready' ? 'Connected' : (status === 'error' ? 'Error' : 'Awaiting QR')),
        commandFiles: config?.commandFiles || []
      }
    })
    
    const commandFiles = CommandRegistry.getAvailableFiles()
    const modulesMetadata = CommandRegistry.getAvailableModules()
    
    return view.render('bot', { 
      clients: clientsData, 
      commandFiles, 
      commandFilesJson: JSON.stringify(commandFiles),
      modulesMetadataJson: JSON.stringify(modulesMetadata)
    })
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

  public async setCommands({ request, response }: HttpContextContract) {
    const clientId = request.input('clientId')
    const commandFiles = request.input('commandFiles', [])
    await this.botService.setCommands(clientId, Array.isArray(commandFiles) ? commandFiles : [commandFiles])
    return response.json({ success: true })
  }

  public async getEditorFiles({ response }: HttpContextContract) {
    return response.json({ files: CommandRegistry.getAvailableFiles() })
  }

  public async getEditorFileContent({ params, response }: HttpContextContract) {
    try {
      const content = await CommandRegistry.getFileContent(params.name)
      return response.json({ success: true, content })
    } catch (e) {
      return response.status(404).json({ success: false, error: 'File not found' })
    }
  }

  public async saveEditorFile({ request, response }: HttpContextContract) {
    try {
      const { filename, content } = request.all()
      await CommandRegistry.saveFileContent(filename, content)
      return response.json({ success: true })
    } catch (e) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async createEditorFile({ request, response }: HttpContextContract) {
    try {
      const { filename } = request.all()
      const safeName = filename.endsWith('.ts') ? filename : `${filename}.ts`
      const template = `import { Client, Message } from 'whatsapp-web.js'\nimport { UserSession } from '../../Services/SessionManager'\n\nexport default class NewModule {\n  public type = 'Module'\n  public instructions = 'Add description here'\n\n  async handle(message: Message, client: Client, session: UserSession) {\n    // Write your logic here\n  }\n}`
      await CommandRegistry.saveFileContent(safeName, template)
      return response.json({ success: true, filename: safeName })
    } catch (e) {
      return response.status(500).json({ success: false, error: e.message })
    }
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