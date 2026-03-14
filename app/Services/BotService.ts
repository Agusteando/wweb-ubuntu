import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import CommandRegistry from 'App/Services/CommandRegistry'
import axios from 'axios'

export interface ClientConfig {
  clientId: string;
  commandFiles: string[];
}

export default class BotService {
  public clients: Map<string, Client> = new Map()
  public qrCodes: Map<string, string | null> = new Map()
  public statuses: Map<string, 'pending' | 'ready' | 'error'> = new Map()
  public configs: Map<string, ClientConfig> = new Map()
  
  private dataDir: string
  private registryFile: string

  constructor() {
    this.dataDir = path.join(Application.appRoot, 'data')
    this.registryFile = path.join(this.dataDir, 'clients.json')
  }

  public async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    await CommandRegistry.loadCommands()

    try {
      const data = await fs.readFile(this.registryFile, 'utf-8')
      const parsed = JSON.parse(data)
      for (const [clientId, config] of Object.entries(parsed)) {
        // Upgrade legacy singular command configs to array
        const rehydratedConfig = config as any
        if (typeof rehydratedConfig.commandFile !== 'undefined') {
          rehydratedConfig.commandFiles = rehydratedConfig.commandFile ? [rehydratedConfig.commandFile] : []
          delete rehydratedConfig.commandFile
        }
        if (!rehydratedConfig.commandFiles) rehydratedConfig.commandFiles = []

        this.configs.set(clientId, rehydratedConfig as ClientConfig)
        this.addClient(clientId, false)
      }
    } catch (e) {
      // First run: Registry does not exist yet. No action needed.
    }
  }

  public async saveRegistry() {
    const data = Object.fromEntries(this.configs)
    await fs.writeFile(this.registryFile, JSON.stringify(data, null, 2), 'utf-8')
  }

  public getOrCreateClient(clientId: string): Client {
    if (!this.clients.has(clientId)) this.addClient(clientId)
    return this.clients.get(clientId)!
  }

  public addClient(clientId: string, saveToRegistry = true): void {
    if (this.clients.has(clientId)) return

    if (saveToRegistry && !this.configs.has(clientId)) {
      this.configs.set(clientId, { clientId, commandFiles: [] })
      this.saveRegistry()
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: path.join(this.dataDir, '.wwebjs_auth') }),
      puppeteer: { 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
      },
    })

    this.clients.set(clientId, client)
    this.qrCodes.set(clientId, null)
    this.statuses.set(clientId, 'pending')

    client.on('qr', (qr) => { this.qrCodes.set(clientId, qr); this.statuses.set(clientId, 'pending') })
    client.on('ready', () => { this.qrCodes.set(clientId, null); this.statuses.set(clientId, 'ready') })
    client.on('auth_failure', () => this.statuses.set(clientId, 'error'))
    client.on('disconnected', () => { this.statuses.set(clientId, 'pending'); client.initialize() })

    client.on('message', async (msg) => { 
      if (!msg.fromMe) await this.handleMessage(clientId, msg, client) 
    })
    client.on('message_create', async (msg) => { 
      if (msg.fromMe) await this.handleMessage(clientId, msg, client) 
    })

    client.initialize().catch(err => {
      console.error(`Error initializing ${clientId}:`, err)
      this.statuses.set(clientId, 'error')
    })
  }

  private async handleMessage(clientId: string, msg: Message, client: Client) {
    const config = this.configs.get(clientId)
    const commandsToRun = config?.commandFiles || []
    await CommandRegistry.execute(commandsToRun, msg, client)
  }

  public async setCommands(clientId: string, commandFiles: string[]) {
    const config = this.configs.get(clientId)
    if (config) {
      config.commandFiles = commandFiles || []
      await this.saveRegistry()
    }
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
    this.configs.delete(clientId)
    await this.saveRegistry()
    
    try {
      await fs.rm(path.join(this.dataDir, '.wwebjs_auth', `session-${clientId}`), { recursive: true, force: true })
    } catch (e) {}
  }
}