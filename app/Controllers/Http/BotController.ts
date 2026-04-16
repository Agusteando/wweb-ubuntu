filepath: app/Controllers/Http/BotController.ts
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

  private get scheduleService(): any {
    return Application.container.use('App/Services/ScheduleService')
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
      modulesMetadataJson: JSON.stringify(modulesMetadata),
      apiStatus: this.botService.apiStatus
    })
  }

  // ==== Scheduler Methods ====

  public async downloadTemplate({ response }: HttpContextContract) {
    const template = [
      {
        "type": "message",
        "chatIds": ["1234567890@c.us"],
        "message": "Hello world!",
        "mediaPath": "https://example.com/image.png",
        "isRecurring": false,
        "timestamp": 1720000000000
      },
      {
        "type": "postTextStatus",
        "statusText": "This is a custom text status update",
        "backgroundColor": "#eb0c0c",
        "fontStyle": 1,
        "isRecurring": false,
        "timestamp": 1720005000000
      },
      {
        "type": "postMediaStatus",
        "mediaPath": "https://example.com/status_image.png",
        "caption": "Status image with a caption",
        "isGif": false,
        "isAudio": false,
        "isRecurring": false,
        "timestamp": 1720010000000
      },
      {
        "type": "revokeStatus",
        "revokeMessageId": "true_status@broadcast_3EB0XXXXX",
        "isRecurring": false,
        "timestamp": 1720015000000
      }
    ]

    response.header('Content-Type', 'application/json')
    response.header('Content-Disposition', 'attachment; filename="status_import_template.json"')
    return response.send(JSON.stringify(template, null, 2))
  }

  public async getSchedules({ params, response }: HttpContextContract) {
    try {
      const schedules = this.scheduleService.getSchedulesForClient(params.clientId)
      const client = this.botService.clients.get(params.clientId)
      
      // Enrich schedules with true view counts dynamically if the client is connected
      if (client && this.botService.statuses.get(params.clientId) === 'ready') {
        let changed = false;
        await Promise.all(schedules.map(async (s) => {
          if (s.statusMessageId) {
            try {
              const msg = await client.getMessageById(s.statusMessageId)
              if (msg) {
                let viewerCount = 0;
                
                // Inspect raw WhatsApp Web message view states natively depending on installed branch logic
                if (Array.isArray((msg as any).viewerReceipts)) {
                    viewerCount = (msg as any).viewerReceipts.length;
                } else if (typeof (msg as any).views === 'number') {
                    viewerCount = (msg as any).views;
                }
                
                // If it exposes the getBroadcast utility cleanly
                if (typeof (msg as any).getBroadcast === 'function') {
                    try {
                        const bcast = await (msg as any).getBroadcast();
                        if (bcast && Array.isArray(bcast.viewerReceipts)) {
                            viewerCount = Math.max(viewerCount, bcast.viewerReceipts.length);
                        } else if (bcast && typeof bcast.views === 'number') {
                            viewerCount = Math.max(viewerCount, bcast.views);
                        }
                    } catch(e){}
                }

                if (viewerCount > (s.viewsCount || 0)) {
                    s.viewsCount = viewerCount;
                    changed = true;
                }
              }
            } catch (err) {
              // Message might have expired naturally after 24 hours. The highest tracked watermark count remains safely.
            }
          }
        }))
        if (changed) {
            await this.scheduleService.save();
        }
      }

      return response.json({ success: true, schedules })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async createSchedule({ params, request, response }: HttpContextContract) {
    try {
      const data = request.all()
      const file = request.file('file')
      
      // Strict payload validation to completely prevent empty status scenarios
      if (data.type === 'postTextStatus' && (!data.statusText || data.statusText.trim() === '')) {
        throw new Error('A valid text body is required for Text Statuses.')
      }
      if (data.type === 'postMediaStatus' && (!file && !data.mediaPath)) {
        throw new Error('A valid file upload or URL is required for Media Statuses.')
      }
      
      // Handle file storage persistently so the scheduler can fetch it perfectly later when execution fires
      if (file) {
        const sessionDir = Env.get('WA_SESSION_DIR')
        if (!sessionDir) throw new Error('WA_SESSION_DIR missing')
        const persistentDir = path.join(sessionDir, 'scheduled_media')
        if (!fs.existsSync(persistentDir)) {
          fs.mkdirSync(persistentDir, { recursive: true })
        }
        const safeName = `${Date.now()}_${file.clientName}`
        await file.move(persistentDir, { name: safeName, overwrite: true })
        data.mediaPath = path.join(persistentDir, safeName)
      }

      // Restore Arrays & Booleans corrupted by FormData flatness during HTTP transition
      if (data.chatIds) data.chatIds = Array.isArray(data.chatIds) ? data.chatIds : [data.chatIds]
      data.isRecurring = data.isRecurring === 'true' || data.isRecurring === true
      if (data.isGif) data.isGif = data.isGif === 'true'
      if (data.isAudio) data.isAudio = data.isAudio === 'true'
      if (data.timestamp) data.timestamp = Number(data.timestamp)
      if (data.fontStyle) data.fontStyle = parseInt(data.fontStyle, 10)

      if (data.isRecurring) {
        data.recurrence = { type: data.recurrenceType, time: data.recurrenceTime }
        if (data.recurrenceType === 'weekly' && data.recurrenceDaysOfWeek) {
            data.recurrence.daysOfWeek = data.recurrenceDaysOfWeek.split(',').map(Number)
        }
        if (data.recurrenceType === 'monthly' && data.recurrenceDayOfMonth) {
            data.recurrence.dayOfMonth = Number(data.recurrenceDayOfMonth)
        }
      }

      const schedule = await this.scheduleService.createSchedule(params.clientId, data)
      return response.json({ success: true, schedule })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async updateSchedule({ params, request, response }: HttpContextContract) {
    try {
      const data = request.all()
      const schedule = await this.scheduleService.updateSchedule(params.clientId, params.id, data)
      return response.json({ success: true, schedule })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async deleteSchedule({ params, response }: HttpContextContract) {
    try {
      await this.scheduleService.deleteSchedule(params.clientId, params.id)
      return response.json({ success: true })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  public async bulkImportSchedules({ params, request, response }: HttpContextContract) {
    try {
      const { items } = request.all()
      const result = await this.scheduleService.bulkCreate(params.clientId, items)
      return response.json({ success: true, count: result.length })
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }

  // ==== API Gateway & Settings Methods ====

  public async getApiLogs({ response }: HttpContextContract) {
    return response.json({ success: true, logs: this.botService.apiLogs })
  }

  public async clearApiLogs({ response }: HttpContextContract) {
    this.botService.apiLogs = []
    return response.json({ success: true })
  }

  public async deleteApiLog({ params, response }: HttpContextContract) {
    this.botService.apiLogs = this.botService.apiLogs.filter(l => l.id !== params.id)
    return response.json({ success: true })
  }

  public async toggleApiStatus({ request, response }: HttpContextContract) {
    const { status } = request.all()
    this.botService.apiStatus = status === true || status === 'true'
    await this.botService.saveRegistry()
    return response.json({ success: true, apiStatus: this.botService.apiStatus })
  }

  // ==========================

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
    let clientId = params.clientId;
    let client;

    if (!this.botService.apiStatus) {
      this.botService.logApi({
        clientId: clientId || 'any',
        endpoint: request.url(),
        method: request.method(),
        status: 'blocked',
        target: String(request.input('chatId') || 'unknown'),
        payloadSummary: `API Disabled. Blocked request.`,
        error: 'API message sending is globally disabled.'
      });
      return response.status(403).json({ status: 'error', error: 'API message sending is currently disabled in the orchestrator.' });
    }

    if (!clientId || clientId.toLowerCase() === 'any') {
      const readyClient = this.botService.getAnyReadyClient();
      if (!readyClient) {
        this.botService.logApi({
          clientId: 'any',
          endpoint: request.url(),
          method: request.method(),
          status: 'error',
          target: String(request.input('chatId') || 'unknown'),
          payloadSummary: `Message dispatch failed`,
          error: 'No WhatsApp clients are currently connected or ready.'
        });
        return response.status(400).json({ status: 'error', error: 'No WhatsApp clients are currently connected or ready to handle requests.' });
      }
      client = readyClient.client;
      clientId = readyClient.id;
    } else {
      client = this.botService.clients.get(clientId);
      if (!client || this.botService.statuses.get(clientId) !== 'ready') {
        this.botService.logApi({
          clientId,
          endpoint: request.url(),
          method: request.method(),
          status: 'error',
          target: String(request.input('chatId') || 'unknown'),
          payloadSummary: `Message dispatch failed`,
          error: `WhatsApp client '${clientId}' is not connected or ready.`
        });
        return response.status(400).json({ status: 'error', error: `WhatsApp client '${clientId}' is not connected or ready.` });
      }
    }

    let {
      chatId,
      message,
      caption,
      mentions,
      filepath,
      mimetype,
      options,
      filename,
    } = request.all();

    const args: any = {};
    let contacts: string[] = [];

    try {
      if (typeof chatId === 'string') chatId = [chatId];
      if (!chatId || !Array.isArray(chatId) || !chatId.length) throw new Error('chatId is undefined, not an array, or empty');

      for (const id of chatId) {
        if (typeof id !== 'string' || !id.includes('@')) throw new Error(`Invalid chatId format: ${id}`);
      }

      if (filepath) {
        const media = await MessageMedia.fromFilePath(filepath);
        if (filename) media.filename = filename;
        if (caption) args.caption = caption;
        message = media;
      } else {
        const uploadedFile = request.file('file');
        if (uploadedFile) {
          const sessionDir = Env.get('WA_SESSION_DIR');
          if (!sessionDir) throw new Error('WA_SESSION_DIR missing');
          const customTempDir = path.join(sessionDir, 'uploads');
          if (!fs.existsSync(customTempDir)) fs.mkdirSync(customTempDir, { recursive: true });

          await uploadedFile.move(customTempDir, { name: uploadedFile.clientName, overwrite: true });
          const tempFilePath = path.join(customTempDir, uploadedFile.clientName);

          const media = await MessageMedia.fromFilePath(tempFilePath);
          media.filename = uploadedFile.clientName;
          args.mimetype = uploadedFile.headers['content-type'] || mimetype;

          if (caption) args.caption = caption;
          message = media;
          fs.unlinkSync(tempFilePath);
        }
      }

      if (!message) {
        message = caption || message;
      } else if (typeof message === 'string') {
        args.caption = message;
      }

      if (mentions && Array.isArray(mentions)) {
        for (let i = 0; i < mentions.length; i++) {
          const mentionStr = String(mentions[i]).trim();
          contacts.push(mentionStr.includes('@') ? mentionStr : `${mentionStr}@c.us`);
        }
        args.mentions = contacts;
      }

      if (options && typeof options === 'object') Object.assign(args, options);

      const sentMessages: any[] = [];
      for (let i = 0; i < chatId.length; i++) {
        const currentChatId = chatId[i];
        try {
          const result = await client.sendMessage(currentChatId, message, args);
          sentMessages.push({ chatId: currentChatId, id: result.id?._serialized ?? result.id, timestamp: result.timestamp });
        } catch (sendMessageError) {
          console.error(`Failed to send message to chat ${currentChatId}:`, sendMessageError);
        }
      }

      const success = sentMessages.length > 0;
      let summaryText = '';
      if (typeof message === 'string') summaryText = message.substring(0, 100);
      else if (caption) summaryText = caption.substring(0, 100);
      else if (filename || mimetype) summaryText = `Media: ${filename || mimetype}`;
      else summaryText = 'Media Payload';

      this.botService.logApi({
        clientId: clientId || 'any',
        endpoint: request.url(),
        method: request.method(),
        status: success ? 'success' : 'error',
        target: chatId.join(', '),
        payloadSummary: summaryText,
        error: success ? undefined : 'Failed to dispatch to one or more targets.'
      });

      return response.json({ status: 'ok', success: true, clientUsed: clientId, messages: sentMessages });
    } catch (error: any) {
      this.botService.logApi({
        clientId: clientId || 'any',
        endpoint: request.url(),
        method: request.method(),
        status: 'error',
        target: String(chatId || request.input('chatId') || 'unknown'),
        payloadSummary: 'Failed request',
        error: error.message || 'An error occurred while sending messages'
      });
      return response.status(500).json({ status: 'error', success: false, error: error.message || 'An error occurred while sending messages' });
    }
  }

  // Live Quick Action endpoint explicitly resolving real status broadcasting logic natively
  public async postStatus({ request, response, params }: HttpContextContract) {
    let clientId = params.clientId;
    let client;

    if (!this.botService.apiStatus) {
      this.botService.logApi({
        clientId: clientId || 'any',
        endpoint: request.url(),
        method: request.method(),
        status: 'blocked',
        target: 'status@broadcast',
        payloadSummary: `Status Post Blocked.`,
        error: 'API message sending is globally disabled.'
      });
      return response.status(403).json({ status: 'error', error: 'API message sending is disabled.' });
    }

    if (!clientId || clientId.toLowerCase() === 'any') {
      const readyClient = this.botService.getAnyReadyClient();
      if (!readyClient) return response.status(400).json({ status: 'error', error: 'No ready clients' });
      client = readyClient.client;
      clientId = readyClient.id;
    } else {
      client = this.botService.clients.get(clientId);
      if (!client || this.botService.statuses.get(clientId) !== 'ready') {
        return response.status(400).json({ status: 'error', error: `Client not ready` });
      }
    }

    const { statusType, statusText, backgroundColor, fontStyle, caption } = request.all();
    const file = request.file('file');

    try {
      if (statusType === 'text') {
        if (!statusText || statusText.trim() === '') throw new Error('Status text is required and cannot be empty.');
        
        const args: any = {};
        if (backgroundColor || fontStyle !== undefined) {
            args.extra = {};
            if (backgroundColor) args.extra.backgroundColor = backgroundColor;
            if (fontStyle !== undefined && fontStyle !== null) args.extra.fontStyle = parseInt(fontStyle, 10);
        }
        
        const result = await client.sendMessage('status@broadcast', statusText, args);
        const messageId = result.id?._serialized ?? result.id;
        
        // Push an inert schedule explicitly so the Status Analytics view tracks its total views dynamically
        await this.scheduleService.createSchedule(clientId, {
            type: 'postTextStatus',
            statusText,
            backgroundColor,
            fontStyle: fontStyle !== undefined && fontStyle !== null ? parseInt(fontStyle, 10) : undefined,
            isRecurring: false,
            timestamp: Date.now(),
            lastRunAt: Date.now(),
            statusMessageId: messageId
        });
        
        this.botService.logApi({
          clientId: clientId,
          endpoint: request.url(),
          method: request.method(),
          status: 'success',
          target: 'status@broadcast',
          payloadSummary: `Text Story: ${statusText.substring(0, 100)}`
        });

        return response.json({ status: 'ok', success: true, clientUsed: clientId, messageId });
        
      } else {
        if (!file) throw new Error('A media file is required to post a media status.');
        
        const sessionDir = Env.get('WA_SESSION_DIR');
        const customTempDir = path.join(sessionDir, 'uploads');
        if (!fs.existsSync(customTempDir)) fs.mkdirSync(customTempDir, { recursive: true });
        
        const safeName = `${Date.now()}_${file.clientName}`;
        await file.move(customTempDir, { name: safeName, overwrite: true });
        const fullPath = path.join(customTempDir, safeName);
        
        const media = await MessageMedia.fromFilePath(fullPath);
        media.filename = file.clientName;
        
        const args: any = {};
        if (caption) args.caption = caption;
        if (statusType === 'gif') args.sendVideoAsGif = true;
        if (statusType === 'audio') args.sendAudioAsVoice = true;

        const result = await client.sendMessage('status@broadcast', media, args);
        fs.unlinkSync(fullPath); 
        
        const messageId = result.id?._serialized ?? result.id;
        
        await this.scheduleService.createSchedule(clientId, {
            type: 'postMediaStatus',
            mediaPath: file.clientName, 
            caption,
            isGif: statusType === 'gif',
            isAudio: statusType === 'audio',
            isRecurring: false,
            timestamp: Date.now(),
            lastRunAt: Date.now(),
            statusMessageId: messageId
        });

        this.botService.logApi({
          clientId: clientId,
          endpoint: request.url(),
          method: request.method(),
          status: 'success',
          target: 'status@broadcast',
          payloadSummary: `Media Story: ${caption ? caption.substring(0, 100) : file.clientName}`
        });

        return response.json({ status: 'ok', success: true, clientUsed: clientId, messageId });
      }
    } catch (error: any) {
      this.botService.logApi({
        clientId: clientId || 'any',
        endpoint: request.url(),
        method: request.method(),
        status: 'error',
        target: 'status@broadcast',
        payloadSummary: 'Status Post Failed',
        error: error.message
      });
      return response.status(500).json({ status: 'error', success: false, error: error.message });
    }
  }

  public async editMessage({ request, response, params }: HttpContextContract) {
    let clientId = params.clientId;
    let client;

    if (!this.botService.apiStatus) {
      this.botService.logApi({
        clientId: clientId || 'any',
        endpoint: request.url(),
        method: request.method(),
        status: 'blocked',
        target: 'Edit Request',
        payloadSummary: `Message Edit Blocked.`,
        error: 'API is globally disabled.'
      });
      return response.status(403).json({ status: 'error', error: 'API message sending is disabled.' });
    }

    if (!clientId || clientId.toLowerCase() === 'any') {
      const readyClient = this.botService.getAnyReadyClient();
      if (!readyClient) return response.status(400).json({ status: 'error', error: 'No clients connected' });
      client = readyClient.client;
      clientId = readyClient.id;
    } else {
      client = this.botService.clients.get(clientId);
      if (!client || this.botService.statuses.get(clientId) !== 'ready') {
        return response.status(400).json({ status: 'error', error: `Client not ready.` });
      }
    }

    const { messageId, content, options } = request.only(['messageId', 'content', 'options']);

    if (!messageId || typeof messageId !== 'string') return response.badRequest({ status: 'error', error: 'messageId is required' });
    if (!content || typeof content !== 'string') return response.badRequest({ status: 'error', error: 'content is required' });

    try {
      const msg = await client.getMessageById(messageId);
      if (!msg) return response.status(404).json({ status: 'error', error: 'Message not found' });
      const edited = await msg.edit(content, options);
      if (!edited) return response.json({ status: 'ok', success: true, message: null });

      this.botService.logApi({
        clientId,
        endpoint: request.url(),
        method: request.method(),
        status: 'success',
        target: edited.to,
        payloadSummary: `Edited: ${content.substring(0, 100)}`
      });

      return response.json({
        status: 'ok',
        success: true,
        clientUsed: clientId,
        message: { id: edited.id?._serialized ?? edited.id, chatId: edited.to, timestamp: edited.timestamp },
      });
    } catch (error: any) {
      this.botService.logApi({
        clientId,
        endpoint: request.url(),
        method: request.method(),
        status: 'error',
        target: 'Edit Request',
        payloadSummary: 'Edit Failed',
        error: error.message
      });
      return response.status(500).json({ status: 'error', success: false, error: error.message });
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