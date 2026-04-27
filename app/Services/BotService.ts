import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import CommandRegistry from 'App/Services/CommandRegistry'
import Env from '@ioc:Adonis/Core/Env'
import { v4 as uuidv4 } from 'uuid'
import * as crypto from 'crypto'

export interface ClientConfig {
  clientId: string;
  commandFiles: string[];
  commandRules?: Record<string, { include: string[], exclude: string[] }>;
  integration?: IntegrationInstanceConfig;
}

export interface ClientHealth {
  failedProbes: number;
  isRecovering: boolean;
  lastRecoveryAttempt: number;
}

export interface IntegrationDeliveryReceipt {
  keyHash: string;
  createdAt: number;
  expiresAt: number;
  statusCode: number;
  response: any;
}

export interface IntegrationInstanceConfig {
  integrationId: string;
  externalClientId?: string;
  displayName?: string;
  webhookUrl?: string;
  allowedOrigins?: string[];
  metadata?: Record<string, any>;
  idempotencyKeyHash?: string;
  createdAt: number;
  updatedAt: number;
  lastConfiguredAt?: number;
  tokenHash?: string;
  tokenLast4?: string;
  tokenPrefix?: string;
  tokenCreatedAt?: number;
  tokenRotatedAt?: number;
  deliveryReceipts?: IntegrationDeliveryReceipt[];
}

export interface IntegrationInstanceDetails {
  clientId: string;
  integrationId: string;
  externalClientId?: string;
  displayName?: string;
  status: 'pending' | 'ready' | 'error';
  statusLabel: string;
  qr: {
    available: boolean;
    updatedAt: number | null;
  };
  session: {
    engineLoaded: boolean;
    authenticated: boolean;
    lastEventAt: number | null;
    lastReason?: string;
  };
  health: ClientHealth | null;
  configuration: {
    commandFiles: string[];
    commandRules: Record<string, { include: string[], exclude: string[] }>;
    webhookUrl?: string;
    allowedOrigins: string[];
    metadata: Record<string, any>;
  };
  credentials: {
    hasToken: boolean;
    tokenPrefix?: string;
    tokenLast4?: string;
    tokenCreatedAt?: number;
    tokenRotatedAt?: number;
  };
  endpoints: Record<string, string>;
  recentActivity?: ApiLog[];
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
  public qrUpdatedAt: Map<string, number> = new Map()
  public statusDetails: Map<string, { updatedAt: number, reason?: string }> = new Map()
  
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

  private createDefaultConfig(clientId: string): ClientConfig {
    const now = Date.now()
    return {
      clientId,
      commandFiles: [],
      commandRules: {},
      integration: {
        integrationId: uuidv4(),
        createdAt: now,
        updatedAt: now,
        allowedOrigins: [],
        metadata: {},
        deliveryReceipts: []
      }
    }
  }

  private ensureIntegrationConfig(config: ClientConfig): IntegrationInstanceConfig {
    const now = Date.now()
    if (!config.integration) {
      config.integration = {
        integrationId: uuidv4(),
        createdAt: now,
        updatedAt: now,
        allowedOrigins: [],
        metadata: {},
        deliveryReceipts: []
      }
    }

    if (!config.integration.integrationId) config.integration.integrationId = uuidv4()
    if (!config.integration.createdAt) config.integration.createdAt = now
    if (!config.integration.updatedAt) config.integration.updatedAt = now
    if (!Array.isArray(config.integration.allowedOrigins)) config.integration.allowedOrigins = []
    if (!config.integration.metadata || typeof config.integration.metadata !== 'object') config.integration.metadata = {}
    if (!Array.isArray(config.integration.deliveryReceipts)) config.integration.deliveryReceipts = []

    return config.integration
  }

  private secretHash(value: string): string {
    return crypto.createHmac('sha256', Env.get('APP_KEY')).update(value).digest('hex')
  }

  private secureCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    if (leftBuffer.length !== rightBuffer.length) return false
    return crypto.timingSafeEqual(leftBuffer, rightBuffer)
  }

  private issueIntegrationToken(config: ClientConfig, rotated = false): string {
    const secret = crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    const token = `wai_${secret}`
    const integration = this.ensureIntegrationConfig(config)
    const now = Date.now()

    integration.tokenHash = this.secretHash(token)
    integration.tokenLast4 = token.slice(-4)
    integration.tokenPrefix = token.slice(0, Math.min(token.length, 16))
    integration.tokenCreatedAt = integration.tokenCreatedAt || now
    if (rotated) integration.tokenRotatedAt = now
    integration.updatedAt = now

    return token
  }

  private integrationEndpoints(baseUrl: string, clientId: string) {
    const root = `${baseUrl}/whatsapp-manager/integration/v1/instances/${encodeURIComponent(clientId)}`
    return {
      instance: root,
      status: `${root}/status`,
      qrStatus: `${root}/qr`,
      qrStream: `${root}/qr/stream`,
      configure: `${root}/configuration`,
      reconnect: `${root}/reconnect`,
      rotateToken: `${root}/token/rotate`,
      sendMessage: `${root}/messages`,
      postStory: `${root}/stories`
    }
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

        this.ensureIntegrationConfig(rehydratedConfig as ClientConfig)
        this.configs.set(clientId, rehydratedConfig as ClientConfig)
        this.addClient(clientId, false)
      }

      await this.saveRegistry()
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
    for (const config of this.configs.values()) {
      this.ensureIntegrationConfig(config)
    }
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
      this.configs.set(clientId, this.createDefaultConfig(clientId))
      this.saveRegistry()
    } else {
      const config = this.configs.get(clientId)
      if (config) this.ensureIntegrationConfig(config)
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
    this.statusDetails.set(clientId, { updatedAt: Date.now(), reason: 'initializing' })

    client.on('qr', (qr) => { 
      this.qrCodes.set(clientId, qr)
      this.qrUpdatedAt.set(clientId, Date.now())
      this.statuses.set(clientId, 'pending')
      this.statusDetails.set(clientId, { updatedAt: Date.now(), reason: 'qr_received' })
    })
    
    client.on('ready', () => { 
      this.qrCodes.set(clientId, null)
      this.statuses.set(clientId, 'ready')
      this.statusDetails.set(clientId, { updatedAt: Date.now(), reason: 'ready' })
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
      this.statusDetails.set(clientId, { updatedAt: Date.now(), reason: `auth_failure: ${msg}` })
      const health = this.healthData.get(clientId)
      if (health) health.failedProbes = 0 // Stop probing, needs manual intervention
    })
    
    client.on('disconnected', async (reason) => { 
      console.log(`[${clientId}] Client disconnected. Reason: ${reason}`)
      this.statusDetails.set(clientId, { updatedAt: Date.now(), reason: `disconnected: ${reason}` })
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
        this.statusDetails.set(clientId, { updatedAt: Date.now(), reason: err.message || 'initialize_error' })
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
      this.ensureIntegrationConfig(config).updatedAt = Date.now()
      await this.saveRegistry()
    }
  }

  public async setCommandRules(clientId: string, commandFile: string, include: string[], exclude: string[]) {
    const config = this.configs.get(clientId)
    if (config) {
      if (!config.commandRules) config.commandRules = {}
      config.commandRules[commandFile] = { include: include || [], exclude: exclude || [] }
      const integration = this.ensureIntegrationConfig(config)
      integration.updatedAt = Date.now()
      integration.lastConfiguredAt = Date.now()
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

  public getRecentLogs(clientId: string, limit = 10): ApiLog[] {
    return this.apiLogs.filter((log) => log.clientId === clientId).slice(0, limit)
  }

  public verifyIntegrationToken(clientId: string, token: string): boolean {
    const config = this.configs.get(clientId)
    if (!config || !token) return false

    const integration = this.ensureIntegrationConfig(config)
    if (!integration.tokenHash) return false

    return this.secureCompare(this.secretHash(token), integration.tokenHash)
  }

  public verifyAdminIntegrationToken(token: string): boolean {
    const configuredToken = Env.get('INTEGRATION_ADMIN_TOKEN')
    if (!configuredToken || !token) return false
    return this.secureCompare(this.secretHash(token), this.secretHash(configuredToken))
  }

  public getIntegrationDetails(clientId: string, baseUrl: string, includeActivity = false): IntegrationInstanceDetails | null {
    const config = this.configs.get(clientId)
    if (!config) return null

    const integration = this.ensureIntegrationConfig(config)
    const status = this.statuses.get(clientId) || 'pending'
    const statusDetail = this.statusDetails.get(clientId)
    const qrAvailable = Boolean(this.qrCodes.get(clientId))

    return {
      clientId,
      integrationId: integration.integrationId,
      externalClientId: integration.externalClientId,
      displayName: integration.displayName,
      status,
      statusLabel: qrAvailable ? 'QR Received' : (status === 'ready' ? 'Connected' : (status === 'error' ? 'Error' : 'Awaiting QR')),
      qr: {
        available: qrAvailable,
        updatedAt: this.qrUpdatedAt.get(clientId) || null
      },
      session: {
        engineLoaded: this.clients.has(clientId),
        authenticated: status === 'ready',
        lastEventAt: statusDetail?.updatedAt || null,
        lastReason: statusDetail?.reason
      },
      health: this.healthData.get(clientId) || null,
      configuration: {
        commandFiles: config.commandFiles || [],
        commandRules: config.commandRules || {},
        webhookUrl: integration.webhookUrl,
        allowedOrigins: integration.allowedOrigins || [],
        metadata: integration.metadata || {}
      },
      credentials: {
        hasToken: Boolean(integration.tokenHash),
        tokenPrefix: integration.tokenPrefix,
        tokenLast4: integration.tokenLast4,
        tokenCreatedAt: integration.tokenCreatedAt,
        tokenRotatedAt: integration.tokenRotatedAt
      },
      endpoints: this.integrationEndpoints(baseUrl, clientId),
      recentActivity: includeActivity ? this.getRecentLogs(clientId, 10) : undefined
    }
  }

  public listIntegrationDetails(baseUrl: string): IntegrationInstanceDetails[] {
    return Array.from(this.configs.keys())
      .sort()
      .map((clientId) => this.getIntegrationDetails(clientId, baseUrl, true))
      .filter((detail): detail is IntegrationInstanceDetails => Boolean(detail))
  }

  public async registerIntegrationClient(input: {
    clientId?: string;
    externalClientId?: string;
    displayName?: string;
    commandFiles?: string[];
    commandRules?: Record<string, { include: string[], exclude: string[] }>;
    webhookUrl?: string;
    allowedOrigins?: string[];
    metadata?: Record<string, any>;
    idempotencyKey?: string;
    issueToken?: boolean;
  }): Promise<{ clientId: string, created: boolean, idempotent: boolean, token: string | null }> {
    const idempotencyKeyHash = input.idempotencyKey ? this.secretHash(input.idempotencyKey) : undefined
    let existingClientId: string | null = null

    if (idempotencyKeyHash) {
      for (const [clientId, config] of this.configs.entries()) {
        if (this.ensureIntegrationConfig(config).idempotencyKeyHash === idempotencyKeyHash) {
          existingClientId = clientId
          break
        }
      }
    }

    if (!existingClientId && input.externalClientId) {
      for (const [clientId, config] of this.configs.entries()) {
        if (this.ensureIntegrationConfig(config).externalClientId === input.externalClientId) {
          existingClientId = clientId
          break
        }
      }
    }

    if (!existingClientId && input.clientId && this.configs.has(input.clientId)) {
      existingClientId = input.clientId
    }

    const clientId = existingClientId || input.clientId || `instance_${uuidv4().replace(/-/g, '').slice(0, 12)}`
    let config = this.configs.get(clientId)
    let created = false
    let token: string | null = null

    if (!config) {
      config = this.createDefaultConfig(clientId)
      this.configs.set(clientId, config)
      created = true
    }

    const integration = this.ensureIntegrationConfig(config)
    if (input.externalClientId) integration.externalClientId = input.externalClientId
    if (input.displayName) integration.displayName = input.displayName
    if (typeof input.webhookUrl === 'string') integration.webhookUrl = input.webhookUrl || undefined
    if (Array.isArray(input.allowedOrigins)) integration.allowedOrigins = input.allowedOrigins
    if (input.metadata && typeof input.metadata === 'object') integration.metadata = input.metadata
    if (idempotencyKeyHash && !integration.idempotencyKeyHash) integration.idempotencyKeyHash = idempotencyKeyHash

    if (Array.isArray(input.commandFiles)) config.commandFiles = input.commandFiles
    if (input.commandRules && typeof input.commandRules === 'object') config.commandRules = input.commandRules

    integration.updatedAt = Date.now()
    integration.lastConfiguredAt = Date.now()

    if (input.issueToken && !integration.tokenHash) {
      token = this.issueIntegrationToken(config)
    }

    await this.saveRegistry()
    this.addClient(clientId, false)

    return { clientId, created, idempotent: Boolean(existingClientId), token }
  }

  public async updateIntegrationConfig(clientId: string, input: {
    externalClientId?: string;
    displayName?: string;
    commandFiles?: string[];
    commandRules?: Record<string, { include: string[], exclude: string[] }>;
    webhookUrl?: string | null;
    allowedOrigins?: string[];
    metadata?: Record<string, any>;
  }): Promise<ClientConfig> {
    const config = this.configs.get(clientId)
    if (!config) throw new Error(`Instance '${clientId}' does not exist`)

    const integration = this.ensureIntegrationConfig(config)
    if (typeof input.externalClientId === 'string') integration.externalClientId = input.externalClientId || undefined
    if (typeof input.displayName === 'string') integration.displayName = input.displayName || undefined
    if (typeof input.webhookUrl === 'string' || input.webhookUrl === null) integration.webhookUrl = input.webhookUrl || undefined
    if (Array.isArray(input.allowedOrigins)) integration.allowedOrigins = input.allowedOrigins
    if (input.metadata && typeof input.metadata === 'object') integration.metadata = input.metadata
    if (Array.isArray(input.commandFiles)) config.commandFiles = input.commandFiles
    if (input.commandRules && typeof input.commandRules === 'object') config.commandRules = input.commandRules

    integration.updatedAt = Date.now()
    integration.lastConfiguredAt = Date.now()
    await this.saveRegistry()

    return config
  }

  public async rotateIntegrationToken(clientId: string): Promise<string> {
    const config = this.configs.get(clientId)
    if (!config) throw new Error(`Instance '${clientId}' does not exist`)

    const token = this.issueIntegrationToken(config, true)
    await this.saveRegistry()
    return token
  }

  public getQrState(clientId: string) {
    const config = this.configs.get(clientId)
    if (!config) return null

    const status = this.statuses.get(clientId) || 'pending'
    const qr = this.qrCodes.get(clientId) || null

    return {
      clientId,
      status,
      qr,
      qrAvailable: Boolean(qr),
      qrUpdatedAt: this.qrUpdatedAt.get(clientId) || null,
      sessionReady: status === 'ready',
      detail: this.statusDetails.get(clientId) || null
    }
  }

  public getDeliveryReceipt(clientId: string, idempotencyKey: string): IntegrationDeliveryReceipt | null {
    const config = this.configs.get(clientId)
    if (!config || !idempotencyKey) return null

    const integration = this.ensureIntegrationConfig(config)
    const keyHash = this.secretHash(idempotencyKey)
    const now = Date.now()
    integration.deliveryReceipts = (integration.deliveryReceipts || []).filter((receipt) => receipt.expiresAt > now)

    return integration.deliveryReceipts.find((receipt) => receipt.keyHash === keyHash) || null
  }

  public async rememberDeliveryReceipt(clientId: string, idempotencyKey: string, statusCode: number, response: any) {
    const config = this.configs.get(clientId)
    if (!config || !idempotencyKey) return

    const integration = this.ensureIntegrationConfig(config)
    const keyHash = this.secretHash(idempotencyKey)
    const now = Date.now()
    const receipts = (integration.deliveryReceipts || []).filter((receipt) => receipt.expiresAt > now && receipt.keyHash !== keyHash)

    receipts.unshift({
      keyHash,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      statusCode,
      response
    })

    integration.deliveryReceipts = receipts.slice(0, 50)
    integration.updatedAt = now
    await this.saveRegistry()
  }

  public async reconnectClient(clientId: string) {
    if (!this.configs.has(clientId)) {
      throw new Error(`Instance '${clientId}' does not exist`)
    }

    if (!this.healthData.has(clientId)) {
      this.healthData.set(clientId, {
        failedProbes: 0,
        isRecovering: false,
        lastRecoveryAttempt: 0
      })
    }

    if (!this.clients.has(clientId)) {
      this.addClient(clientId, false)
      return
    }

    await this.recoverClient(clientId, 'Manual reconnect requested')
  }

  public async removeClient(clientId: string) {
    const client = this.clients.get(clientId)
    
    if (client) {
      await client.destroy().catch(() => {})
      this.clients.delete(clientId)
    }
    
    this.initLocks.delete(clientId)
    this.qrCodes.delete(clientId)
    this.qrUpdatedAt.delete(clientId)
    this.statuses.delete(clientId)
    this.statusDetails.delete(clientId)
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
    this.statusDetails.set(clientId, { updatedAt: Date.now(), reason })

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
