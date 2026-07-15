import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import { installReliableClientSend } from 'App/Whatsapp/Utils/ReliableClientSend'
import path from 'path'
import CommandRegistry from 'App/Services/CommandRegistry'
import Env from '@ioc:Adonis/Core/Env'
import { v4 as uuidv4 } from 'uuid'
import * as crypto from 'crypto'
import SessionVault from 'App/Services/SessionVault'

export interface ClientConfig {
  clientId: string;
  commandFiles: string[];
  commandRules?: Record<string, { include: string[], exclude: string[] }>;
  integration?: IntegrationInstanceConfig;
}

export type PublicClientStatus = 'pending' | 'ready' | 'error'

export type SessionRuntimeState =
  | 'initializing'
  | 'qr'
  | 'authenticated'
  | 'ready'
  | 'degraded'
  | 'recovering'
  | 'unpaired'
  | 'error'
  | 'fatal'

export interface ClientHealth {
  failedProbes: number;
  isRecovering: boolean;
  lastRecoveryAttempt: number;
  lastProbeAt?: number;
  lastGoodStateAt?: number;
  lastKnownState?: string | null;
  startedAt?: number;
  readyAt?: number;
  recoveryCount?: number;
  restoreCount?: number;
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
  status: PublicClientStatus;
  statusLabel: string;
  qr: {
    available: boolean;
    updatedAt: number | null;
  };
  session: {
    engineLoaded: boolean;
    authenticated: boolean;
    state: SessionRuntimeState;
    lastEventAt: number | null;
    lastReason?: string;
    lastKnownState?: string | null;
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
  public statuses: Map<string, PublicClientStatus> = new Map()
  public runtimeStates: Map<string, SessionRuntimeState> = new Map()
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
  private vault: SessionVault
  
  private isShuttingDown: boolean = false
  private initLocks: Set<string> = new Set()
  private supervisorInterval: ReturnType<typeof setInterval> | null = null
  private scheduledRecycleInterval: ReturnType<typeof setInterval> | null = null
  private readyTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private recoveryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private static processGuardsInstalled = false

  constructor() {
    this.dataDir = Env.get('WA_SESSION_DIR')
    
    if (!this.dataDir) {
      throw new Error('CRITICAL: WA_SESSION_DIR environment variable is missing. It must be set to an absolute external path.')
    }

    // Fully isolated external paths
    this.authDir = path.join(this.dataDir, 'auth')
    this.registryFile = path.join(this.dataDir, 'clients.json')
    this.vault = new SessionVault(
      this.dataDir,
      this.authDir,
      this.registryFile,
      {
        retention: this.envNumber('WA_SESSION_BACKUP_RETENTION', 2, 0, 20),
        maxBackupBytes: this.envNumber('WA_SESSION_BACKUP_MAX_MB', 512, 0, 10240) * 1024 * 1024,
        maxBackupAgeMs: this.envNumber('WA_SESSION_BACKUP_MAX_AGE_DAYS', 7, 0, 365) * 24 * 60 * 60 * 1000,
      }
    )
  }

  private envNumber(name: string, fallback: number, min?: number, max?: number): number {
    const raw = Env.get(name as any)
    const parsed = typeof raw === 'number' ? raw : Number(raw)
    const allowsZero = typeof min === 'number' && min <= 0
    let value = Number.isFinite(parsed) && (parsed > 0 || (allowsZero && parsed === 0)) ? parsed : fallback
    if (typeof min === 'number') value = Math.max(min, value)
    if (typeof max === 'number') value = Math.min(max, value)
    return value
  }

  private envString(name: string, fallback: string): string {
    const raw = Env.get(name as any)
    return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  }

  private setRuntimeState(clientId: string, state: SessionRuntimeState, reason?: string) {
    this.runtimeStates.set(clientId, state)

    const publicStatus: PublicClientStatus = state === 'ready'
      ? 'ready'
      : ['error', 'fatal', 'unpaired'].includes(state)
        ? 'error'
        : 'pending'

    this.statuses.set(clientId, publicStatus)
    this.statusDetails.set(clientId, {
      updatedAt: Date.now(),
      reason: reason || state
    })
  }

  private statusLabel(clientId: string): string {
    if (this.qrCodes.get(clientId)) return 'QR Received'

    const runtimeState = this.runtimeStates.get(clientId)
    switch (runtimeState) {
      case 'ready': return 'Connected'
      case 'authenticated': return 'Authenticated, waiting for ready'
      case 'recovering': return 'Recovering session'
      case 'degraded': return 'Degraded, probing recovery'
      case 'unpaired': return 'Unpaired, QR required'
      case 'fatal': return 'Fatal runtime error'
      case 'error': return 'Error'
      case 'initializing': return 'Starting engine'
      case 'qr': return 'Awaiting QR'
      default: return 'Awaiting QR'
    }
  }

  private clearReadyTimeout(clientId: string) {
    const timer = this.readyTimeouts.get(clientId)
    if (timer) clearTimeout(timer)
    this.readyTimeouts.delete(clientId)
  }

  private armReadyTimeout(clientId: string, context: string) {
    this.clearReadyTimeout(clientId)
    const timeoutMs = this.envNumber('WA_READY_TIMEOUT_MS', 120000, 30000, 900000)
    const timer = setTimeout(() => {
      const state = this.runtimeStates.get(clientId)
      if (this.isShuttingDown || !this.configs.has(clientId)) return
      if (state === 'ready' || state === 'qr' || state === 'unpaired' || state === 'fatal' || state === 'error') return
      this.recoverClient(clientId, `Ready timeout after ${Math.round(timeoutMs / 1000)}s during ${context}`)
    }, timeoutMs)
    if (typeof (timer as any).unref === 'function') (timer as any).unref()
    this.readyTimeouts.set(clientId, timer)
  }

  private clearRecoveryTimer(clientId: string) {
    const timer = this.recoveryTimers.get(clientId)
    if (timer) clearTimeout(timer)
    this.recoveryTimers.delete(clientId)
  }

  private ensureHealth(clientId: string): ClientHealth {
    if (!this.healthData.has(clientId)) {
      this.healthData.set(clientId, {
        failedProbes: 0,
        isRecovering: false,
        lastRecoveryAttempt: 0,
        startedAt: Date.now(),
        recoveryCount: 0,
        restoreCount: 0
      })
    }
    return this.healthData.get(clientId)!
  }

  private isBrowserCriticalError(error: any): boolean {
    const text = `${error?.message || error || ''} ${error?.stack || ''}`.toLowerCase()
    return [
      'protocol error',
      'session closed',
      'target closed',
      'browser has disconnected',
      'browser disconnected',
      'execution context was destroyed',
      'websocket is not open',
      'navigation failed because browser has disconnected'
    ].some((needle) => text.includes(needle))
  }

  private installProcessGuards() {
    if (BotService.processGuardsInstalled) return
    BotService.processGuardsInstalled = true

    process.on('unhandledRejection', (reason) => {
      this.handleProcessFault('unhandledRejection', reason).catch((error) => {
        console.error('[process-guard] Failed while handling unhandled rejection:', error)
      })
    })

    process.on('uncaughtException', (error) => {
      this.handleProcessFault('uncaughtException', error, true).catch((fault) => {
        console.error('[process-guard] Failed while handling uncaught exception:', fault)
        process.exit(1)
      })
    })
  }

  private async handleProcessFault(kind: string, error: any, forceExit = false) {
    console.error(`[process-guard] ${kind}:`, error)

    const shouldExit = forceExit || this.isBrowserCriticalError(error)
    if (!shouldExit) return

    try {
      await this.emergencySnapshotAll(kind)
    } catch (snapshotError) {
      console.error('[process-guard] Emergency snapshot failed:', snapshotError)
    }

    setTimeout(() => process.exit(1), 1000)
  }

  private async emergencySnapshotAll(reason: string) {
    await this.vault.snapshotRegistry({ reason, minIntervalMs: 0 }).catch((error) => {
      console.error('[session-vault] Emergency registry snapshot failed:', error)
    })

    for (const clientId of this.configs.keys()) {
      await this.vault.snapshotClientSession(clientId, `emergency-${reason}`).catch((error) => {
        console.error(`[session-vault] Emergency session snapshot failed for ${clientId}:`, error)
      })
    }
  }

  private startSupervisor() {
    if (this.supervisorInterval) clearInterval(this.supervisorInterval)
    const intervalMs = this.envNumber('WA_HEALTH_INTERVAL_MS', 60000, 15000, 600000)
    this.supervisorInterval = setInterval(() => this.runHealthChecks(), intervalMs)
    if (typeof (this.supervisorInterval as any).unref === 'function') (this.supervisorInterval as any).unref()
  }

  private startScheduledRecycle() {
    if (this.scheduledRecycleInterval) clearInterval(this.scheduledRecycleInterval)

    const recycleHours = this.envNumber('WA_SCHEDULED_RECYCLE_HOURS', 12, 0, 168)
    if (recycleHours <= 0) return

    const intervalMs = recycleHours * 60 * 60 * 1000
    this.scheduledRecycleInterval = setInterval(() => {
      this.recycleReadyClients(`Scheduled ${recycleHours}h recycle`).catch((error) => {
        console.error('[scheduled-recycle] Failed:', error)
      })
    }, intervalMs)
    if (typeof (this.scheduledRecycleInterval as any).unref === 'function') (this.scheduledRecycleInterval as any).unref()
  }

  private async recycleReadyClients(reason: string) {
    if (this.isShuttingDown) return
    for (const [clientId, status] of this.statuses.entries()) {
      if (status === 'ready') {
        await this.recoverClient(clientId, reason)
      }
    }
  }

  private async destroyClientInstance(clientId: string, client: Client, reason: string): Promise<void> {
    await CommandRegistry.stopAutomations(clientId).catch((error) => {
      console.error(`[${clientId}] Error stopping automations before destroy:`, error)
    })

    const snapshotBeforeDestroy = ['recovery', 'scheduled-recycle', 'manual-reconnect'].some((token) => reason.includes(token))
    if (snapshotBeforeDestroy) {
      await this.vault.snapshotClientSession(clientId, `pre-${reason}`, { minIntervalMs: this.envNumber('WA_SESSION_SNAPSHOT_MIN_INTERVAL_MS', 6 * 60 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000) }).catch((error) => {
        console.warn(`[${clientId}] Pre-destroy session snapshot skipped/failed:`, error?.message || error)
      })
    }

    const browserProcess = (client as any)?.pupBrowser?.process?.()
    const browserPid = browserProcess?.pid

    try {
      await Promise.race([
        client.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), this.envNumber('WA_DESTROY_TIMEOUT_MS', 10000, 3000, 60000)))
      ])
      console.log(`[${clientId}] Client destroyed cleanly (${reason}).`)
    } catch (error: any) {
      console.error(`[${clientId}] Error destroying client (${reason}):`, error?.message || error)
    }

    if (browserPid) {
      await this.killBrowserProcess(clientId, browserPid)
    }

  }

  private async killBrowserProcess(clientId: string, pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGKILL')
        console.warn(`[${clientId}] Force-killed orphan Chromium process ${pid}.`)
      } catch (_) {}
    } catch (_) {}
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
    await this.vault.ensure()
    await CommandRegistry.loadCommands()
    this.installProcessGuards()

    const loadResult = await this.vault.loadRegistry()
    const parsed = loadResult.data

    if (loadResult.restoredFromBackup) {
      console.warn('[session-vault] Registry was restored from backup before booting clients.')
    }

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

      const sessionState = await this.vault.ensureClientSessionIfRecoverable(clientId)
      if (sessionState === 'restored') {
        const health = this.ensureHealth(clientId)
        health.restoreCount = (health.restoreCount || 0) + 1
        this.setRuntimeState(clientId, 'recovering', 'LocalAuth restored from session backup on startup')
      } else if (sessionState === 'missing') {
        this.setRuntimeState(clientId, 'initializing', 'No LocalAuth folder found; QR may be required')
      }

      this.addClient(clientId, false)
    }

    await this.saveRegistry()
    this.startSupervisor()
    this.startScheduledRecycle()
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
    if (this.scheduledRecycleInterval) {
      clearInterval(this.scheduledRecycleInterval)
      this.scheduledRecycleInterval = null
    }

    for (const clientId of this.readyTimeouts.keys()) this.clearReadyTimeout(clientId)
    for (const clientId of this.recoveryTimers.keys()) this.clearRecoveryTimer(clientId)

    await this.vault.snapshotRegistry({ reason: 'shutdown', minIntervalMs: 0 }).catch((error) => {
      console.error('[session-vault] Failed to snapshot registry during shutdown:', error)
    })

    const destructionPromises: Promise<void>[] = []
    
    for (const [clientId, client] of this.clients.entries()) {
      const destroyPromise = this.destroyClientInstance(clientId, client, 'shutdown')
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, this.envNumber('WA_SHUTDOWN_TIMEOUT_MS', 12000, 3000, 60000)))
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

    await this.vault.snapshotRegistry({ reason: 'pre-registry-write', minIntervalMs: 5 * 60 * 1000 }).catch((error) => {
      console.warn('[session-vault] Registry snapshot skipped/failed before write:', error?.message || error)
    })
    await this.vault.atomicWriteJson(this.registryFile, data)
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
      this.saveRegistry().catch((error) => {
        console.error(`[${clientId}] Failed to save registry while adding client:`, error)
      })
    } else {
      const config = this.configs.get(clientId)
      if (config) this.ensureIntegrationConfig(config)
    }

    const health = this.ensureHealth(clientId)
    health.startedAt = Date.now()

    const client = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: this.authDir }),
      puppeteer: { 
        headless: true, 
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync'
        ] 
      },
    })

    installReliableClientSend(client, clientId)

    this.clients.set(clientId, client)
    this.qrCodes.set(clientId, null)
    this.setRuntimeState(clientId, 'initializing', 'initializing')
    this.armReadyTimeout(clientId, 'initialization')

    client.on('qr', (qr) => { 
      this.clearReadyTimeout(clientId)
      this.qrCodes.set(clientId, qr)
      this.qrUpdatedAt.set(clientId, Date.now())
      this.setRuntimeState(clientId, 'qr', 'qr_received')
    })

    client.on('authenticated', () => {
      this.qrCodes.set(clientId, null)
      this.setRuntimeState(clientId, 'authenticated', 'authenticated')
      this.armReadyTimeout(clientId, 'authenticated_waiting_for_ready')
    })
    
    client.on('ready', async () => { 
      this.clearReadyTimeout(clientId)
      this.qrCodes.set(clientId, null)
      this.setRuntimeState(clientId, 'ready', 'ready')
      const readyHealth = this.ensureHealth(clientId)
      readyHealth.failedProbes = 0
      readyHealth.isRecovering = false
      readyHealth.readyAt = Date.now()
      readyHealth.lastGoodStateAt = Date.now()
      readyHealth.lastKnownState = 'CONNECTED'

      await this.vault.snapshotClientSession(clientId, 'ready', { minIntervalMs: this.envNumber('WA_SESSION_SNAPSHOT_MIN_INTERVAL_MS', 6 * 60 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000) }).catch((error) => {
        console.warn(`[${clientId}] Ready-state session snapshot skipped/failed:`, error?.message || error)
      })

      const config = this.configs.get(clientId)
      await CommandRegistry.reconcileAutomations(clientId, client, config?.commandFiles || [])
      console.log(`[${clientId}] Client is healthy and ready.`)
    })

    client.on('change_state', (state) => {
      const stateText = String(state || '')
      const stateHealth = this.ensureHealth(clientId)
      stateHealth.lastKnownState = stateText
      stateHealth.lastProbeAt = Date.now()

      if (stateText === 'CONNECTED') {
        stateHealth.lastGoodStateAt = Date.now()
        if (this.runtimeStates.get(clientId) !== 'ready') {
          this.setRuntimeState(clientId, 'ready', `change_state: ${stateText}`)
        }
      } else if (stateText === 'UNPAIRED' || stateText === 'UNPAIRED_IDLE') {
        this.clearReadyTimeout(clientId)
        this.setRuntimeState(clientId, 'unpaired', `change_state: ${stateText}`)
      }
    })
    
    client.on('auth_failure', (msg) => {
      this.clearReadyTimeout(clientId)
      console.error(`[${clientId}] Authentication failed. Session was not deleted: ${msg}`)
      this.setRuntimeState(clientId, 'error', `auth_failure: ${msg}`)
      const authHealth = this.ensureHealth(clientId)
      authHealth.failedProbes = 0
    })
    
    client.on('disconnected', async (reason) => { 
      console.log(`[${clientId}] Client disconnected. Reason: ${reason}`)
      this.clearReadyTimeout(clientId)
      await CommandRegistry.stopAutomations(clientId)
      this.setRuntimeState(clientId, 'degraded', `disconnected: ${reason}`)
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

    ;(client as any).on?.('error', (error: any) => {
      console.error(`[${clientId}] Client emitted error:`, error)
      if (this.isBrowserCriticalError(error)) {
        this.recoverClient(clientId, `Browser/client error: ${error?.message || error}`)
      }
    })

    client.initialize()
      .then(() => {
        this.initLocks.delete(clientId)
      })
      .catch(async (err: any) => {
        console.error(`[${clientId}] Error initializing client:`, err)
        this.clearReadyTimeout(clientId)
        this.setRuntimeState(clientId, 'error', err.message || 'initialize_error')
        this.initLocks.delete(clientId)

        if (this.isBrowserCriticalError(err)) {
          await this.recoverClient(clientId, `Initialize browser failure: ${err.message || err}`)
        }
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

      const client = this.clients.get(clientId)
      if (client && this.statuses.get(clientId) === 'ready') {
        await CommandRegistry.reconcileAutomations(clientId, client, config.commandFiles)
      }
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
    const runtimeState = this.runtimeStates.get(clientId) || 'initializing'
    const statusDetail = this.statusDetails.get(clientId)
    const qrAvailable = Boolean(this.qrCodes.get(clientId))
    const health = this.healthData.get(clientId) || null

    return {
      clientId,
      integrationId: integration.integrationId,
      externalClientId: integration.externalClientId,
      displayName: integration.displayName,
      status,
      statusLabel: this.statusLabel(clientId),
      qr: {
        available: qrAvailable,
        updatedAt: this.qrUpdatedAt.get(clientId) || null
      },
      session: {
        engineLoaded: this.clients.has(clientId),
        authenticated: runtimeState === 'authenticated' || runtimeState === 'ready',
        state: runtimeState,
        lastEventAt: statusDetail?.updatedAt || null,
        lastReason: statusDetail?.reason,
        lastKnownState: health?.lastKnownState || null
      },
      health,
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
      runtimeState: this.runtimeStates.get(clientId) || 'initializing',
      statusLabel: this.statusLabel(clientId),
      qr,
      qrAvailable: Boolean(qr),
      qrUpdatedAt: this.qrUpdatedAt.get(clientId) || null,
      sessionReady: status === 'ready',
      detail: this.statusDetails.get(clientId) || null,
      health: this.healthData.get(clientId) || null
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
    this.clearReadyTimeout(clientId)
    this.clearRecoveryTimer(clientId)
    
    if (client) {
      await this.destroyClientInstance(clientId, client, 'remove-client')
      this.clients.delete(clientId)
    }
    
    this.initLocks.delete(clientId)
    this.qrCodes.delete(clientId)
    this.qrUpdatedAt.delete(clientId)
    this.statuses.delete(clientId)
    this.runtimeStates.delete(clientId)
    this.statusDetails.delete(clientId)
    this.configs.delete(clientId)
    this.healthData.delete(clientId)
    await this.saveRegistry()
    
    const removePolicy = this.envString('WA_REMOVE_CLIENT_SESSION_POLICY', 'delete').toLowerCase()
    try {
      if (removePolicy === 'keep') {
        console.warn(`[${clientId}] Removed from registry but LocalAuth session was kept because WA_REMOVE_CLIENT_SESSION_POLICY=keep.`)
      } else if (removePolicy === 'quarantine') {
        await this.vault.quarantineClientSession(clientId, 'removed-from-manager')
      } else {
        await this.vault.deleteClientSession(clientId)
      }
    } catch (e: any) {
      console.error(`[${clientId}] Failed to apply LocalAuth removal policy '${removePolicy}':`, e?.message || e)
    }
  }

  /* 
  |--------------------------------------------------------------------------
  | Health Supervision & Recovery Routine
  |--------------------------------------------------------------------------
  */

  private runHealthChecks() {
    if (this.isShuttingDown) return
    for (const [clientId, client] of this.clients.entries()) {
      this.checkClientHealth(clientId, client).catch(err => {
        console.error(`[${clientId}] Unexpected error in health check:`, err)
      })
    }
  }

  private async checkClientHealth(clientId: string, client: Client) {
    const health = this.ensureHealth(clientId)
    if (health.isRecovering) return

    const runtimeState = this.runtimeStates.get(clientId) || 'initializing'
    health.lastProbeAt = Date.now()

    if (runtimeState === 'qr' || runtimeState === 'unpaired' || runtimeState === 'error' || runtimeState === 'fatal') {
      return
    }

    if (runtimeState !== 'ready' && runtimeState !== 'degraded') {
      const startedAt = health.startedAt || this.statusDetails.get(clientId)?.updatedAt || Date.now()
      const timeoutMs = this.envNumber('WA_READY_TIMEOUT_MS', 120000, 30000, 900000)
      if (Date.now() - startedAt > timeoutMs) {
        await this.recoverClient(clientId, `Non-ready state '${runtimeState}' exceeded ${Math.round(timeoutMs / 1000)}s`)
      }
      return
    }

    try {
      const probeTimeoutMs = this.envNumber('WA_PROBE_TIMEOUT_MS', 15000, 3000, 60000)
      const state = await Promise.race([
        client.getState(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), probeTimeoutMs))
      ])

      health.lastKnownState = state

      if (state === 'CONNECTED') {
        if (health.failedProbes > 0) {
          console.log(`[${clientId}] Health recovered naturally. State: ${state}`)
        }
        health.failedProbes = 0
        health.lastGoodStateAt = Date.now()
        if (this.runtimeStates.get(clientId) !== 'ready') this.setRuntimeState(clientId, 'ready', 'probe_connected')
      } else if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
        console.error(`[${clientId}] Client is unpaired. Automated recovery stopped to preserve session files.`)
        this.setRuntimeState(clientId, 'unpaired', `probe_state: ${state}`)
        health.failedProbes = 0
      } else {
        console.warn(`[${clientId}] Client degraded. State: ${state}`)
        this.setRuntimeState(clientId, 'degraded', `probe_state: ${state}`)
        health.failedProbes++
      }
    } catch (error: any) {
      console.warn(`[${clientId}] Health probe failed (${health.failedProbes + 1}/${this.envNumber('WA_RECOVERY_FAILURE_THRESHOLD', 3, 1, 20)}): ${error.message}`)
      health.failedProbes++
      if (this.runtimeStates.get(clientId) === 'ready') {
        this.setRuntimeState(clientId, 'degraded', `probe_failed: ${error.message}`)
      }
    }

    const threshold = this.envNumber('WA_RECOVERY_FAILURE_THRESHOLD', 3, 1, 20)
    if (health.failedProbes >= threshold && !health.isRecovering) {
      await this.recoverClient(clientId, `Stale/Unresponsive (${threshold} consecutive probe failures)`)
    }
  }

  private async recoverClient(clientId: string, reason: string) {
    const health = this.ensureHealth(clientId)
    if (health.isRecovering) return

    const now = Date.now()
    let delayBeforeRestart = this.envNumber('WA_RECOVERY_DELAY_MS', 5000, 1000, 300000)

    if (now - health.lastRecoveryAttempt < 2 * 60 * 1000) {
      const backoffMs = this.envNumber('WA_RECOVERY_BACKOFF_MS', 60000, 5000, 600000)
      console.warn(`[${clientId}] Recovery churn detected. Engaging ${Math.round(backoffMs / 1000)}s backoff.`)
      delayBeforeRestart = backoffMs
    }

    health.isRecovering = true
    health.lastRecoveryAttempt = now
    health.failedProbes = 0
    health.recoveryCount = (health.recoveryCount || 0) + 1

    console.log(`[${clientId}] Initiating targeted recovery. Reason: ${reason}`)
    this.setRuntimeState(clientId, 'recovering', reason)
    this.clearReadyTimeout(clientId)
    this.clearRecoveryTimer(clientId)

    await this.vault.snapshotRegistry({ reason: `recovery-${clientId}`, minIntervalMs: 0 }).catch((error) => {
      console.warn(`[${clientId}] Registry snapshot before recovery failed:`, error?.message || error)
    })

    const client = this.clients.get(clientId)
    if (client) {
      await this.destroyClientInstance(clientId, client, `recovery-${reason}`)
    }
    
    this.clients.delete(clientId)
    this.initLocks.delete(clientId)

    const timer = setTimeout(() => {
      if (!this.isShuttingDown && this.configs.has(clientId)) {
        console.log(`[${clientId}] Restarting client instance post-recovery...`)
        health.isRecovering = false
        health.startedAt = Date.now()
        this.addClient(clientId, false)
      }
      this.recoveryTimers.delete(clientId)
    }, delayBeforeRestart)
    if (typeof (timer as any).unref === 'function') (timer as any).unref()
    this.recoveryTimers.set(clientId, timer)
  }

}