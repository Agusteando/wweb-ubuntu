import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import CommandRegistry from 'App/Services/CommandRegistry'
import Env from '@ioc:Adonis/Core/Env'
import { v4 as uuidv4 } from 'uuid'

export interface ClientConfig {
  clientId: string;
  commandFiles: string[];
  commandRules?: Record<string, { include: string[], exclude: string[] }>;
}

export interface ClientHealth {
  failedProbes: number;
  isRecovering: boolean;
  lastRecoveryAttempt: number;
}

export interface ApiLog {
  id: string;
  timestamp: number;
  clientId: string;
  endpoint: string;
  method: string;
  status: 'success' | 'error' | 'blocked';
  target: string;
  payloadSummary: string;
  error?: string;
}

export default class BotService {
  public clients: Map<string, Client> = new Map()
  public qrCodes: Map<string, string | null> = new Map()
  public statuses: Map<string, 'pending' | 'ready' | 'error'> = new Map()
  public configs: Map<string, ClientConfig> = new Map()
  public healthData: Map<string, ClientHealth> = new Map()
  
  // Global API configurations
  public apiStatus: boolean = true
  public apiLogs: ApiLog[] = []
  
  private dataDir: string
  private authDir: string
  private registryFile: string
  
  private isShuttingDown: boolean = false
  private initLocks: Set<string> = new Set()
  private supervisorInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.dataDir = Env.get('WA_SESSION_DIR')
    
    if (!this.dataDir) {
      throw new Error('CRITICAL: WA_SESSION_DIR environment variable is missing. It must be set to an absolute external path.')
    }

    // Fully isolated external paths
    this.authDir = path.join(this.dataDir, 'auth')
    this.registryFile = path.join(this.dataDir, 'clients.json')
  }

  public async init() {
    await fs.mkdir(this.authDir, { recursive: true })
    await CommandRegistry.loadCommands()

    try {
      const data = await fs.readFile(this.registryFile, 'utf-8')
      const parsed = JSON.parse(data)

      if (parsed.__global_settings__) {
        this.apiStatus = parsed.__global_settings__.apiStatus ?? true
        delete parsed.__global_settings__
      }

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
      // First run: Registry does not exist yet. No action needed.
    }

    // Begin the background health supervisor
    this.supervisorInterval = setInterval(() => this.runHealthChecks(), 60000)
  }

  public logApi(logData: Omit<ApiLog, 'id' | 'timestamp'>) {
    const log: ApiLog = {
      ...logData,
      id: uuidv4(),
      timestamp: Date.now()
    }
    this.apiLogs.unshift(log)
    if (this.apiLogs.length > 200) {
      this.apiLogs.pop()
    }
  }

  public async shutdown() {
    this.isShuttingDown = true
    if (this.supervisorInterval) {
      clearInterval(this.supervisorInterval)
      this.supervisorInterval = null
    }

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
    const data: any = Object.fromEntries(this.configs)
    data.__global_settings__ = { apiStatus: this.apiStatus }
    await fs.writeFile(this.registryFile, JSON.stringify(data, null, 2), 'utf-8')
  }

  // Locates the first available and fully ready client to use as a fallback API client
  public getAnyReadyClient(): { id: string, client: Client } | null {
    for (const [id, status] of this.statuses.entries()) {
      if (status === 'ready') {
        const client = this.clients.get(id)
        if (client) return { id, client }
      }
    }
    return null
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

    if (!this.healthData.has(clientId)) {
      this.healthData.set(clientId, {
        failedProbes: 0,
        isRecovering: false,
        lastRecoveryAttempt: 0
      })
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

    client.on('qr', (qr) => { 
      this.qrCodes.set(clientId, qr)
      this.statuses.set(clientId, 'pending') 
    })
    
    client.on('ready', () => { 
      this.qrCodes.set(clientId, null)
      this.statuses.set(clientId, 'ready')
      const health = this.healthData.get(clientId)
      if (health) {
        health.failedProbes = 0
        health.isRecovering = false
      }
      console.log(`[${clientId}] Client is healthy and ready.`)
    })
    
    client.on('auth_failure', (msg) => {
      console.error(`[${clientId}] Authentication failed. Hard failure: ${msg}`)
      this.statuses.set(clientId, 'error')
      const health = this.healthData.get(clientId)
      if (health) health.failedProbes = 0 // Stop probing, needs manual intervention
    })
    
    client.on('disconnected', async (reason) => { 
      console.log(`[${clientId}] Client disconnected. Reason: ${reason}`)
      if (!this.isShuttingDown) {
        this.recoverClient(clientId, `Disconnected (${reason})`)
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
    this.healthData.delete(clientId)
    await this.saveRegistry()
    
    try {
      await fs.rm(path.join(this.authDir, `session-${clientId}`), { recursive: true, force: true })
    } catch (e: any) {}
  }

  /* 
  |--------------------------------------------------------------------------
  | Health Supervision & Recovery Routine
  |--------------------------------------------------------------------------
  */

  private runHealthChecks() {
    if (this.isShuttingDown) return
    for (const [clientId, client] of this.clients.entries()) {
      // Fire and forget so one hanging client does not block others
      this.checkClientHealth(clientId, client).catch(err => {
        console.error(`[${clientId}] Unexpected error in health check:`, err)
      })
    }
  }

  private async checkClientHealth(clientId: string, client: Client) {
    if (this.statuses.get(clientId) !== 'ready') return
    
    const health = this.healthData.get(clientId)
    if (!health || health.isRecovering) return

    try {
      // Attempt to retrieve state, forcing a resolution within 15s if Puppeteer hangs
      const state = await Promise.race([
        client.getState(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000))
      ])

      if (state === 'CONNECTED') {
        if (health.failedProbes > 0) {
          console.log(`[${clientId}] Health recovered naturally. State: ${state}`)
        }
        health.failedProbes = 0
      } else if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
        console.error(`[${clientId}] Client is unpaired. Hard failure.`)
        this.statuses.set(clientId, 'error')
        health.failedProbes = 0 // Device was unlinked; Do not attempt automated recovery
      } else {
        console.warn(`[${clientId}] Client degraded. State: ${state}`)
        health.failedProbes++
      }
    } catch (error: any) {
      console.warn(`[${clientId}] Health probe failed (${health.failedProbes + 1}/3): ${error.message}`)
      health.failedProbes++
    }

    if (health.failedProbes >= 3 && !health.isRecovering) {
      this.recoverClient(clientId, 'Stale/Unresponsive (3 consecutive probe failures)')
    }
  }

  private async recoverClient(clientId: string, reason: string) {
    const health = this.healthData.get(clientId)
    if (!health) return

    if (health.isRecovering) return

    const now = Date.now()
    let delayBeforeRestart = 5000

    // Detect if we are churning (multiple restarts within 2 minutes)
    if (now - health.lastRecoveryAttempt < 2 * 60 * 1000) {
      console.warn(`[${clientId}] Recovery churn detected. Engaging 60s backoff.`)
      delayBeforeRestart = 60000
    }

    health.isRecovering = true
    health.lastRecoveryAttempt = now
    health.failedProbes = 0

    console.log(`[${clientId}] Initiating targeted recovery. Reason: ${reason}`)
    this.statuses.set(clientId, 'pending') // Triggers "Starting Engine..." in frontend

    const client = this.clients.get(clientId)
    if (client) {
      try {
        await Promise.race([
          client.destroy(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), 10000))
        ])
        console.log(`[${clientId}] Client destroyed successfully for recovery.`)
      } catch (err: any) {
        console.error(`[${clientId}] Error destroying client during recovery:`, err.message)
      }
    }
    
    // Completely clear out of memory references
    this.clients.delete(clientId)
    this.initLocks.delete(clientId)

    // Wait before breathing life back into the container
    setTimeout(() => {
      // Ensure it wasn't intentionally removed by the UI while it was delayed
      if (!this.isShuttingDown && this.configs.has(clientId)) {
        console.log(`[${clientId}] Restarting client instance post-recovery...`)
        health.isRecovering = false
        this.addClient(clientId, false)
      }
    }, delayBeforeRestart)
  }
}