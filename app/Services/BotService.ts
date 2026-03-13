import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import CommandRegistry from 'App/Services/CommandRegistry'
import axios from 'axios'

export default class BotService {
  public clients: Map<string, Client> = new Map()
  public qrCodes: Map<string, string | null> = new Map()
  public statuses: Map<string, 'pending' | 'ready' | 'error'> = new Map()
  private dataDir: string

  constructor() {
    this.dataDir = path.join(Application.appRoot, 'data')
    this.init()
  }

  private async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    await CommandRegistry.loadCommands()
  }

  public getOrCreateClient(clientId: string): Client {
    if (!this.clients.has(clientId)) this.addClient(clientId)
    return this.clients.get(clientId)!
  }

  public addClient(clientId: string): void {
    if (this.clients.has(clientId)) return

    const client = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: path.join(this.dataDir, '.wwebjs_auth') }),
      puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    })

    this.clients.set(clientId, client)
    this.qrCodes.set(clientId, null)
    this.statuses.set(clientId, 'pending')

    client.on('qr', (qr) => { this.qrCodes.set(clientId, qr); this.statuses.set(clientId, 'pending') })
    client.on('ready', () => { this.qrCodes.set(clientId, null); this.statuses.set(clientId, 'ready') })
    client.on('auth_failure', () => this.statuses.set(clientId, 'error'))
    client.on('disconnected', () => { this.statuses.set(clientId, 'pending'); client.initialize() })

    client.on('message', async (msg) => { if (!msg.fromMe) await CommandRegistry.execute(msg, client) })
    client.on('message_create', async (msg) => { if (msg.fromMe) await CommandRegistry.execute(msg, client) })

    client.initialize().catch(err => {
      console.error(`Error initializing ${clientId}:`, err)
      this.statuses.set(clientId, 'error')
    })
  }

  public async sendMessage(clientId: string, chatId: string, text: string) {
    const client = this.getOrCreateClient(clientId)
    return client.sendMessage(chatId, text)
  }

  public async sendMedia(clientId: string, chatId: string, mediaType: 'url'|'path'|'base64', source: string, caption?: string, mimeType?: string, filename?: string) {
    const client = this.getOrCreateClient(clientId)
    let media: MessageMedia

    try {
      if (mediaType === 'url') {
        const response = await axios.get(source, { responseType: 'arraybuffer' })
        const b64data = Buffer.from(response.data, 'binary').toString('base64')
        const detectedMime = response.headers['content-type'] || mimeType || 'application/octet-stream'
        media = new MessageMedia(detectedMime, b64data, filename || 'file')
      } 
      else if (mediaType === 'path') {
        const fullPath = path.resolve(source)
        media = MessageMedia.fromFilePath(fullPath)
      } 
      else if (mediaType === 'base64') {
        if (!mimeType) throw new Error("mimeType is required for base64 uploads")
        media = new MessageMedia(mimeType, source, filename || 'file')
      } else {
        throw new Error('Invalid mediaType')
      }

      return await client.sendMessage(chatId, media, { caption })
    } catch (e) {
      console.error(`Media Sending Error for ${clientId}:`, e)
      throw new Error(`Failed to send media: ${e.message}`)
    }
  }

  public async removeClient(clientId: string) {
    const client = this.clients.get(clientId)
    if (client) {
      await client.destroy().catch(() => {})
      this.clients.delete(clientId)
    }
    this.qrCodes.delete(clientId)
    this.statuses.delete(clientId)
  }
}