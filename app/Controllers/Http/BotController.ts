import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Application from '@ioc:Adonis/Core/Application'
import Env from '@ioc:Adonis/Core/Env'
import type BotService from 'App/Services/BotService'
import CommandRegistry from 'App/Services/CommandRegistry'
import fs from 'fs'
import path from 'path'
import { MessageMedia } from 'whatsapp-web.js'

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
        commandFiles: config?.commandFiles || [],
        commandRules: config?.commandRules || {}
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

  public async getChats({ params, response }: HttpContextContract) {
    try {
      const chats = await this.botService.getChats(params.clientId)
      return response.json({ success: true, chats })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async saveRules({ request, response, params }: HttpContextContract) {
    try {
      const { commandFile, include, exclude } = request.all()
      await this.botService.setCommandRules(params.clientId, commandFile, include, exclude)
      return response.json({ success: true })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async getEditorFiles({ response }: HttpContextContract) {
    return response.json({ files: CommandRegistry.getAvailableFiles() })
  }

  public async getEditorFileContent({ params, response }: HttpContextContract) {
    try {
      const content = await CommandRegistry.getFileContent(params.name)
      return response.json({ success: true, content })
    } catch (e: any) {
      return response.status(404).json({ success: false, error: 'File not found' })
    }
  }

  public async saveEditorFile({ request, response }: HttpContextContract) {
    try {
      const { filename, content } = request.all()
      await CommandRegistry.saveFileContent(filename, content)
      return response.json({ success: true })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async createEditorFile({ request, response }: HttpContextContract) {
    try {
      const { filename } = request.all()
      const safeName = filename.endsWith('.ts') ? filename : `${filename}.ts`
      const template = `import { Client, Message } from 'whatsapp-web.js'\nimport { UserSession } from 'App/Services/SessionManager'\n\nexport default class NewModule {\n  public type = 'Module'\n  public instructions = 'Add description here'\n\n  async handle(message: Message, _client: Client, _session: UserSession) {\n    // Write your logic here\n  }\n}`
      await CommandRegistry.saveFileContent(safeName, template)
      return response.json({ success: true, filename: safeName })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async sendMessages({ request, response, params }: HttpContextContract) {
    const clientId = params.clientId;
    const client = this.botService.clients.get(clientId);

    if (!client) {
      return response.status(400).json({ status: 'error', error: 'WhatsApp client is not connected or ready' });
    }

    let {
      chatId,
      message,
      caption,
      audio,
      mentions,
      filepath,
      mimetype,
      options,
      filename,
    } = request.all();

    const args: any = {};
    let contacts: string[] = [];
    let mediaMessage: MessageMedia | null = null;

    try {
      if (typeof chatId === 'string') {
        chatId = [chatId];
      }

      if (!chatId || !Array.isArray(chatId) || !chatId.length) {
        throw new Error('chatId is undefined, not an array, or empty');
      }

      for (const id of chatId) {
        if (typeof id !== 'string' || !id.includes('@')) {
          throw new Error(`Invalid chatId format: ${id}`);
        }
      }

      // Handle file if `filepath` is given
      if (filepath) {
        mediaMessage = await MessageMedia.fromFilePath(filepath);
        if (filename) mediaMessage.filename = filename;
        if (mimetype) mediaMessage.mimetype = mimetype;
      } else {
        // Handle uploaded file from the request securely outside the app root
        const uploadedFile = request.file('file');

        if (uploadedFile) {
          const sessionDir = Env.get('WA_SESSION_DIR');
          if (!sessionDir) throw new Error('WA_SESSION_DIR missing');
          
          const customTempDir = path.join(sessionDir, 'uploads');
          if (!fs.existsSync(customTempDir)) {
            fs.mkdirSync(customTempDir, { recursive: true });
          }

          const safeFilename = `${Date.now()}_${uploadedFile.clientName}`;
          await uploadedFile.move(customTempDir, {
            name: safeFilename,
            overwrite: true,
          });

          const tempFilePath = path.join(customTempDir, safeFilename);

          mediaMessage = await MessageMedia.fromFilePath(tempFilePath);
          
          if (filename || uploadedFile.clientName) {
            mediaMessage.filename = filename || uploadedFile.clientName;
          }

          const resolvedMime = uploadedFile.headers['content-type'] || mimetype;
          if (resolvedMime) {
            mediaMessage.mimetype = resolvedMime;
          }

          fs.unlinkSync(tempFilePath);
        }
      }

      let finalMessageContent: any;

      if (mediaMessage) {
        finalMessageContent = mediaMessage;
        
        // Handle caption vs message correctly
        if (caption) {
          args.caption = caption;
        } else if (typeof message === 'string') {
          args.caption = message;
        }

        // Intelligently force inline display for visual media instead of document attachment
        const isImageOrVideo = mediaMessage.mimetype.startsWith('image/') || mediaMessage.mimetype.startsWith('video/');
        if (isImageOrVideo) {
          args.sendMediaAsDocument = false; 
        }

        // Intelligently route audio payloads as direct Voice Notes
        if (audio || mediaMessage.mimetype.startsWith('audio/')) {
          args.sendAudioAsVoice = true;
        }

      } else {
        // If no media is provided, assume it's a plain text message
        finalMessageContent = message || caption || '';
      }

      // Handle mentions
      if (mentions) {
        for (let i = 0; i < mentions.length; i++) {
          contacts.push(mentions[i] + '@c.us');
        }
        args.mentions = contacts;
      }

      // Merge in arbitrary options (can safely override the smart settings above if explicitly requested)
      if (options && typeof options === 'object') {
        Object.assign(args, options);
      }

      const sentMessages: any[] = [];

      for (let i = 0; i < chatId.length; i++) {
        const currentChatId = chatId[i];
        try {
          const result = await client.sendMessage(currentChatId, finalMessageContent, args);
          sentMessages.push({
            chatId: currentChatId,
            id: result.id?._serialized ?? result.id,
            timestamp: result.timestamp,
          });
        } catch (sendMessageError) {
          console.error(`Failed to send message to chat ${currentChatId}:`, sendMessageError);
        }
      }

      return response.json({
        status: 'ok',
        success: true,
        messages: sentMessages,
      });
    } catch (error: any) {
      console.error('Error in sendMessages:', error);
      return response.status(500).json({
        status: 'error',
        success: false,
        error: error.message || 'An error occurred while sending messages',
      });
    }
  }

  public async editMessage({ request, response, params }: HttpContextContract) {
    const clientId = params.clientId;
    const client = this.botService.clients.get(clientId);

    if (!client) {
      return response.status(400).json({ status: 'error', error: 'WhatsApp client is not connected or ready' });
    }

    const { messageId, content, options } = request.only(['messageId', 'content', 'options']);

    if (!messageId || typeof messageId !== 'string') {
      return response.badRequest({ status: 'error', error: 'messageId is required' });
    }

    if (!content || typeof content !== 'string') {
      return response.badRequest({ status: 'error', error: 'content is required' });
    }

    try {
      const msg = await client.getMessageById(messageId);

      if (!msg) {
        return response.status(404).json({ status: 'error', error: 'Message not found' });
      }

      const edited = await msg.edit(content, options);

      if (!edited) {
        return response.json({ status: 'ok', success: true, message: null });
      }

      return response.json({
        status: 'ok',
        success: true,
        message: {
          id: edited.id?._serialized ?? edited.id,
          chatId: edited.to,
          timestamp: edited.timestamp,
        },
      });
    } catch (error: any) {
      console.error('Error in editMessage:', error);
      return response.status(500).json({
        status: 'error',
        success: false,
        error: error.message || 'An error occurred while editing the message',
      });
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