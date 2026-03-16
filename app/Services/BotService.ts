import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import CommandRegistry from 'App/Services/CommandRegistry'
import Env from '@ioc:Adonis/Core/Env'

export interface ClientConfig {
  clientId: string;
  commandFiles: string[];
  commandRules?: Record<string, { include: string[], exclude: string[] }>;
}

export default class BotService {
  public clients: Map<string, Client> = new Map()
  public qrCodes: Map<string, string | null> = new Map()
  public statuses: Map<string, 'pending' | 'ready' | 'error'> = new Map()
  public configs: Map<string, ClientConfig> = new Map()
  
  private dataDir: string
  private authDir: string
  private registryFile: string
  
  private isShuttingDown: boolean = false
  private initLocks: Set<string> = new Set()

  constructor() {
    this.dataDir = Env.get('WA_SESSION_DIR')
    
    if (!this.dataDir) {
      throw new Error('CRITICAL: WA_SESSION_DIR environment variable is missing.')
    }

    this.authDir = path.join(this.dataDir, 'auth')
    this.registryFile = path.join(this.dataDir, 'clients.json')
  }

  public async init() {
    await fs.mkdir(this.authDir, { recursive: true })
    await CommandRegistry.loadCommands()

    try {
      const data = await fs.readFile(this.registryFile, 'utf-8')
      const parsed = JSON.parse(data)
      for (const [clientId, config] of Object.entries(parsed)) {
        const rehydratedConfig = config as any
        if (typeof rehydratedConfig.commandFile !== 'undefined') {
          rehydratedConfig.commandFiles = rehydratedConfig.commandFile ? [rehydratedConfig.commandFile] : []
          delete rehydratedConfig.commandFile
        }
        if (!rehydratedConfig.commandFiles) rehydratedConfig.commandFiles = []
        if (!rehydratedConfig.commandRules) rehydratedConfig.commandRules = {}

        this.configs.set(clientId, rehydratedConfig as ClientConfig)
        this.addClient(clientId, false)
      }
    } catch (e: any) {
      // Registry missing on first boot, safe to ignore.
    }
  }

  public async shutdown() {
    this.isShuttingDown = true
    const destructionPromises: Promise<void>[] = []
    
    for (const [clientId, client] of this.clients.entries()) {
      const destroyPromise = new Promise<void>(async (resolve) => {
        try {
          await client.destroy()
          console.log(`[${clientId}] Gracefully closed Chromium profile.`)
        } catch (err) {
          console.error(`[${clientId}] Error closing client during shutdown:`, err)
        } finally {
          resolve()
        }
      })
      
      // Forcefully resolve after 8 seconds to prevent PM2 hang
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 8000))
      destructionPromises.push(Promise.race([destroyPromise, timeoutPromise]))
    }

    await Promise.all(destructionPromises)
    this.clients.clear()
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
    if (this.isShuttingDown) return
    if (this.clients.has(clientId)) return
    if (this.initLocks.has(clientId)) return

    this.initLocks.add(clientId)

    if (saveToRegistry && !this.configs.has(clientId)) {
      this.configs.set(clientId, { clientId, commandFiles: [], commandRules: {} })
      this.saveRegistry()
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: this.authDir }),
      puppeteer: { 
        headless: true, 
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ] 
      },
    })

    this.clients.set(clientId, client)
    this.qrCodes.set(clientId, null)
    this.statuses.set(clientId, 'pending')

    client.on('qr', (qr) => { this.qrCodes.set(clientId, qr); this.statuses.set(clientId, 'pending') })
    client.on('ready', () => { this.qrCodes.set(clientId, null); this.statuses.set(clientId, 'ready') })
    client.on('auth_failure', () => this.statuses.set(clientId, 'error'))
    
    client.on('disconnected', async (reason) => { 
      console.log(`[${clientId}] Client disconnected. Reason: ${reason}`)
      this.statuses.set(clientId, 'pending')
      
      if (!this.isShuttingDown) {
        await client.destroy().catch(() => {})
        this.clients.delete(clientId)
        setTimeout(() => {
          if (!this.isShuttingDown) this.addClient(clientId, false)
        }, 5000)
      }
    })

    client.on('message', async (msg) => { 
      if (!msg.fromMe) await this.handleMessage(clientId, msg, client) 
    })
    client.on('message_create', async (msg) => { 
      if (msg.fromMe) await this.handleMessage(clientId, msg, client) 
    })

    client.initialize()
      .then(() => {
        this.initLocks.delete(clientId)
      })
      .catch((err: any) => {
        console.error(`[${clientId}] Error initializing client:`, err)
        this.statuses.set(clientId, 'error')
        this.initLocks.delete(clientId)
      })
  }

  private async handleMessage(clientId: string, msg: Message, client: Client) {
    const config = this.configs.get(clientId)
    const commandsToRun = config?.commandFiles || []
    const rules = config?.commandRules || {}
    await CommandRegistry.execute(commandsToRun, msg, client, rules)
  }

  public async setCommands(clientId: string, commandFiles: string[]) {
    const config = this.configs.get(clientId)
    if (config) {
      config.commandFiles = commandFiles || []
      await this.saveRegistry()
    }
  }

  public async setCommandRules(clientId: string, commandFile: string, include: string[], exclude: string[]) {
    const config = this.configs.get(clientId)
    if (config) {
      if (!config.commandRules) config.commandRules = {}
      config.commandRules[commandFile] = { include: include || [], exclude: exclude || [] }
      await this.saveRegistry()
    }
  }

  public async getChats(clientId: string) {
    const client = this.clients.get(clientId)
    if (!client || this.statuses.get(clientId) !== 'ready') {
      throw new Error('Client is not connected')
    }
    const chats = await client.getChats()
    return chats.map(c => ({
      id: c.id._serialized,
      name: c.name || c.id.user,
      isGroup: c.isGroup
    }))
  }

  public async removeClient(clientId: string) {
    const client = this.clients.get(clientId)
    
    if (client) {
      await client.destroy().catch(() => {})
      this.clients.delete(clientId)
    }
    
    this.initLocks.delete(clientId)
    this.qrCodes.delete(clientId)
    this.statuses.delete(clientId)
    this.configs.delete(clientId)
    await this.saveRegistry()
    
    try {
      await fs.rm(path.join(this.authDir, `session-${clientId}`), { recursive: true, force: true })
    } catch (e: any) {}
  }
}