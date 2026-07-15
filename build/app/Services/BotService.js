"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const ReliableClientSend_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/ReliableClientSend");
const path_1 = __importDefault(require("path"));
const CommandRegistry_1 = __importDefault(global[Symbol.for('ioc.use')]("App/Services/CommandRegistry"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const uuid_1 = require("uuid");
const crypto = __importStar(require("crypto"));
const SessionVault_1 = __importDefault(global[Symbol.for('ioc.use')]("App/Services/SessionVault"));
class BotService {
    constructor() {
        this.clients = new Map();
        this.qrCodes = new Map();
        this.statuses = new Map();
        this.runtimeStates = new Map();
        this.configs = new Map();
        this.healthData = new Map();
        this.qrUpdatedAt = new Map();
        this.statusDetails = new Map();
        this.apiStatus = true;
        this.apiLogs = [];
        this.isShuttingDown = false;
        this.initLocks = new Set();
        this.supervisorInterval = null;
        this.scheduledRecycleInterval = null;
        this.readyTimeouts = new Map();
        this.recoveryTimers = new Map();
        this.dataDir = Env_1.default.get('WA_SESSION_DIR');
        if (!this.dataDir) {
            throw new Error('CRITICAL: WA_SESSION_DIR environment variable is missing. It must be set to an absolute external path.');
        }
        this.authDir = path_1.default.join(this.dataDir, 'auth');
        this.registryFile = path_1.default.join(this.dataDir, 'clients.json');
        this.vault = new SessionVault_1.default(this.dataDir, this.authDir, this.registryFile, {
            retention: this.envNumber('WA_SESSION_BACKUP_RETENTION', 2, 0, 20),
            maxBackupBytes: this.envNumber('WA_SESSION_BACKUP_MAX_MB', 512, 0, 10240) * 1024 * 1024,
            maxBackupAgeMs: this.envNumber('WA_SESSION_BACKUP_MAX_AGE_DAYS', 7, 0, 365) * 24 * 60 * 60 * 1000,
        });
    }
    envNumber(name, fallback, min, max) {
        const raw = Env_1.default.get(name);
        const parsed = typeof raw === 'number' ? raw : Number(raw);
        const allowsZero = typeof min === 'number' && min <= 0;
        let value = Number.isFinite(parsed) && (parsed > 0 || (allowsZero && parsed === 0)) ? parsed : fallback;
        if (typeof min === 'number')
            value = Math.max(min, value);
        if (typeof max === 'number')
            value = Math.min(max, value);
        return value;
    }
    envString(name, fallback) {
        const raw = Env_1.default.get(name);
        return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
    }
    setRuntimeState(clientId, state, reason) {
        this.runtimeStates.set(clientId, state);
        const publicStatus = state === 'ready'
            ? 'ready'
            : ['error', 'fatal', 'unpaired'].includes(state)
                ? 'error'
                : 'pending';
        this.statuses.set(clientId, publicStatus);
        this.statusDetails.set(clientId, {
            updatedAt: Date.now(),
            reason: reason || state
        });
    }
    statusLabel(clientId) {
        if (this.qrCodes.get(clientId))
            return 'QR Received';
        const runtimeState = this.runtimeStates.get(clientId);
        switch (runtimeState) {
            case 'ready': return 'Connected';
            case 'authenticated': return 'Authenticated, waiting for ready';
            case 'recovering': return 'Recovering session';
            case 'degraded': return 'Degraded, probing recovery';
            case 'unpaired': return 'Unpaired, QR required';
            case 'fatal': return 'Fatal runtime error';
            case 'error': return 'Error';
            case 'initializing': return 'Starting engine';
            case 'qr': return 'Awaiting QR';
            default: return 'Awaiting QR';
        }
    }
    clearReadyTimeout(clientId) {
        const timer = this.readyTimeouts.get(clientId);
        if (timer)
            clearTimeout(timer);
        this.readyTimeouts.delete(clientId);
    }
    armReadyTimeout(clientId, context) {
        this.clearReadyTimeout(clientId);
        const timeoutMs = this.envNumber('WA_READY_TIMEOUT_MS', 120000, 30000, 900000);
        const timer = setTimeout(() => {
            const state = this.runtimeStates.get(clientId);
            if (this.isShuttingDown || !this.configs.has(clientId))
                return;
            if (state === 'ready' || state === 'qr' || state === 'unpaired' || state === 'fatal' || state === 'error')
                return;
            this.recoverClient(clientId, `Ready timeout after ${Math.round(timeoutMs / 1000)}s during ${context}`);
        }, timeoutMs);
        if (typeof timer.unref === 'function')
            timer.unref();
        this.readyTimeouts.set(clientId, timer);
    }
    clearRecoveryTimer(clientId) {
        const timer = this.recoveryTimers.get(clientId);
        if (timer)
            clearTimeout(timer);
        this.recoveryTimers.delete(clientId);
    }
    ensureHealth(clientId) {
        if (!this.healthData.has(clientId)) {
            this.healthData.set(clientId, {
                failedProbes: 0,
                isRecovering: false,
                lastRecoveryAttempt: 0,
                startedAt: Date.now(),
                recoveryCount: 0,
                restoreCount: 0
            });
        }
        return this.healthData.get(clientId);
    }
    isBrowserCriticalError(error) {
        const text = `${error?.message || error || ''} ${error?.stack || ''}`.toLowerCase();
        return [
            'protocol error',
            'session closed',
            'target closed',
            'browser has disconnected',
            'browser disconnected',
            'execution context was destroyed',
            'websocket is not open',
            'navigation failed because browser has disconnected'
        ].some((needle) => text.includes(needle));
    }
    installProcessGuards() {
        if (BotService.processGuardsInstalled)
            return;
        BotService.processGuardsInstalled = true;
        process.on('unhandledRejection', (reason) => {
            this.handleProcessFault('unhandledRejection', reason).catch((error) => {
                console.error('[process-guard] Failed while handling unhandled rejection:', error);
            });
        });
        process.on('uncaughtException', (error) => {
            this.handleProcessFault('uncaughtException', error, true).catch((fault) => {
                console.error('[process-guard] Failed while handling uncaught exception:', fault);
                process.exit(1);
            });
        });
    }
    async handleProcessFault(kind, error, forceExit = false) {
        console.error(`[process-guard] ${kind}:`, error);
        const shouldExit = forceExit || this.isBrowserCriticalError(error);
        if (!shouldExit)
            return;
        try {
            await this.emergencySnapshotAll(kind);
        }
        catch (snapshotError) {
            console.error('[process-guard] Emergency snapshot failed:', snapshotError);
        }
        setTimeout(() => process.exit(1), 1000);
    }
    async emergencySnapshotAll(reason) {
        await this.vault.snapshotRegistry({ reason, minIntervalMs: 0 }).catch((error) => {
            console.error('[session-vault] Emergency registry snapshot failed:', error);
        });
        for (const clientId of this.configs.keys()) {
            await this.vault.snapshotClientSession(clientId, `emergency-${reason}`).catch((error) => {
                console.error(`[session-vault] Emergency session snapshot failed for ${clientId}:`, error);
            });
        }
    }
    startSupervisor() {
        if (this.supervisorInterval)
            clearInterval(this.supervisorInterval);
        const intervalMs = this.envNumber('WA_HEALTH_INTERVAL_MS', 60000, 15000, 600000);
        this.supervisorInterval = setInterval(() => this.runHealthChecks(), intervalMs);
        if (typeof this.supervisorInterval.unref === 'function')
            this.supervisorInterval.unref();
    }
    startScheduledRecycle() {
        if (this.scheduledRecycleInterval)
            clearInterval(this.scheduledRecycleInterval);
        const recycleHours = this.envNumber('WA_SCHEDULED_RECYCLE_HOURS', 12, 0, 168);
        if (recycleHours <= 0)
            return;
        const intervalMs = recycleHours * 60 * 60 * 1000;
        this.scheduledRecycleInterval = setInterval(() => {
            this.recycleReadyClients(`Scheduled ${recycleHours}h recycle`).catch((error) => {
                console.error('[scheduled-recycle] Failed:', error);
            });
        }, intervalMs);
        if (typeof this.scheduledRecycleInterval.unref === 'function')
            this.scheduledRecycleInterval.unref();
    }
    async recycleReadyClients(reason) {
        if (this.isShuttingDown)
            return;
        for (const [clientId, status] of this.statuses.entries()) {
            if (status === 'ready') {
                await this.recoverClient(clientId, reason);
            }
        }
    }
    async destroyClientInstance(clientId, client, reason) {
        await CommandRegistry_1.default.stopAutomations(clientId).catch((error) => {
            console.error(`[${clientId}] Error stopping automations before destroy:`, error);
        });
        const snapshotBeforeDestroy = ['recovery', 'scheduled-recycle', 'manual-reconnect'].some((token) => reason.includes(token));
        if (snapshotBeforeDestroy) {
            await this.vault.snapshotClientSession(clientId, `pre-${reason}`, { minIntervalMs: this.envNumber('WA_SESSION_SNAPSHOT_MIN_INTERVAL_MS', 6 * 60 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000) }).catch((error) => {
                console.warn(`[${clientId}] Pre-destroy session snapshot skipped/failed:`, error?.message || error);
            });
        }
        const browserProcess = client?.pupBrowser?.process?.();
        const browserPid = browserProcess?.pid;
        try {
            await Promise.race([
                client.destroy(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), this.envNumber('WA_DESTROY_TIMEOUT_MS', 10000, 3000, 60000)))
            ]);
            console.log(`[${clientId}] Client destroyed cleanly (${reason}).`);
        }
        catch (error) {
            console.error(`[${clientId}] Error destroying client (${reason}):`, error?.message || error);
        }
        if (browserPid) {
            await this.killBrowserProcess(clientId, browserPid);
        }
    }
    async killBrowserProcess(clientId, pid) {
        try {
            process.kill(pid, 'SIGTERM');
            await new Promise((resolve) => setTimeout(resolve, 1500));
            try {
                process.kill(pid, 0);
                process.kill(pid, 'SIGKILL');
                console.warn(`[${clientId}] Force-killed orphan Chromium process ${pid}.`);
            }
            catch (_) { }
        }
        catch (_) { }
    }
    createDefaultConfig(clientId) {
        const now = Date.now();
        return {
            clientId,
            commandFiles: [],
            commandRules: {},
            integration: {
                integrationId: (0, uuid_1.v4)(),
                createdAt: now,
                updatedAt: now,
                allowedOrigins: [],
                metadata: {},
                deliveryReceipts: []
            }
        };
    }
    ensureIntegrationConfig(config) {
        const now = Date.now();
        if (!config.integration) {
            config.integration = {
                integrationId: (0, uuid_1.v4)(),
                createdAt: now,
                updatedAt: now,
                allowedOrigins: [],
                metadata: {},
                deliveryReceipts: []
            };
        }
        if (!config.integration.integrationId)
            config.integration.integrationId = (0, uuid_1.v4)();
        if (!config.integration.createdAt)
            config.integration.createdAt = now;
        if (!config.integration.updatedAt)
            config.integration.updatedAt = now;
        if (!Array.isArray(config.integration.allowedOrigins))
            config.integration.allowedOrigins = [];
        if (!config.integration.metadata || typeof config.integration.metadata !== 'object')
            config.integration.metadata = {};
        if (!Array.isArray(config.integration.deliveryReceipts))
            config.integration.deliveryReceipts = [];
        return config.integration;
    }
    secretHash(value) {
        return crypto.createHmac('sha256', Env_1.default.get('APP_KEY')).update(value).digest('hex');
    }
    secureCompare(left, right) {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        if (leftBuffer.length !== rightBuffer.length)
            return false;
        return crypto.timingSafeEqual(leftBuffer, rightBuffer);
    }
    issueIntegrationToken(config, rotated = false) {
        const secret = crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const token = `wai_${secret}`;
        const integration = this.ensureIntegrationConfig(config);
        const now = Date.now();
        integration.tokenHash = this.secretHash(token);
        integration.tokenLast4 = token.slice(-4);
        integration.tokenPrefix = token.slice(0, Math.min(token.length, 16));
        integration.tokenCreatedAt = integration.tokenCreatedAt || now;
        if (rotated)
            integration.tokenRotatedAt = now;
        integration.updatedAt = now;
        return token;
    }
    integrationEndpoints(baseUrl, clientId) {
        const root = `${baseUrl}/whatsapp-manager/integration/v1/instances/${encodeURIComponent(clientId)}`;
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
        };
    }
    async init() {
        await this.vault.ensure();
        await CommandRegistry_1.default.loadCommands();
        this.installProcessGuards();
        const loadResult = await this.vault.loadRegistry();
        const parsed = loadResult.data;
        if (loadResult.restoredFromBackup) {
            console.warn('[session-vault] Registry was restored from backup before booting clients.');
        }
        if (parsed.__global_settings__) {
            this.apiStatus = parsed.__global_settings__.apiStatus ?? true;
            delete parsed.__global_settings__;
        }
        for (const [clientId, config] of Object.entries(parsed)) {
            const rehydratedConfig = config;
            if (typeof rehydratedConfig.commandFile !== 'undefined') {
                rehydratedConfig.commandFiles = rehydratedConfig.commandFile ? [rehydratedConfig.commandFile] : [];
                delete rehydratedConfig.commandFile;
            }
            if (!rehydratedConfig.commandFiles)
                rehydratedConfig.commandFiles = [];
            if (!rehydratedConfig.commandRules)
                rehydratedConfig.commandRules = {};
            this.ensureIntegrationConfig(rehydratedConfig);
            this.configs.set(clientId, rehydratedConfig);
            const sessionState = await this.vault.ensureClientSessionIfRecoverable(clientId);
            if (sessionState === 'restored') {
                const health = this.ensureHealth(clientId);
                health.restoreCount = (health.restoreCount || 0) + 1;
                this.setRuntimeState(clientId, 'recovering', 'LocalAuth restored from session backup on startup');
            }
            else if (sessionState === 'missing') {
                this.setRuntimeState(clientId, 'initializing', 'No LocalAuth folder found; QR may be required');
            }
            this.addClient(clientId, false);
        }
        await this.saveRegistry();
        this.startSupervisor();
        this.startScheduledRecycle();
    }
    logApi(logData) {
        const log = {
            ...logData,
            id: (0, uuid_1.v4)(),
            timestamp: Date.now()
        };
        this.apiLogs.unshift(log);
        if (this.apiLogs.length > 200) {
            this.apiLogs.pop();
        }
    }
    async shutdown() {
        this.isShuttingDown = true;
        if (this.supervisorInterval) {
            clearInterval(this.supervisorInterval);
            this.supervisorInterval = null;
        }
        if (this.scheduledRecycleInterval) {
            clearInterval(this.scheduledRecycleInterval);
            this.scheduledRecycleInterval = null;
        }
        for (const clientId of this.readyTimeouts.keys())
            this.clearReadyTimeout(clientId);
        for (const clientId of this.recoveryTimers.keys())
            this.clearRecoveryTimer(clientId);
        await this.vault.snapshotRegistry({ reason: 'shutdown', minIntervalMs: 0 }).catch((error) => {
            console.error('[session-vault] Failed to snapshot registry during shutdown:', error);
        });
        const destructionPromises = [];
        for (const [clientId, client] of this.clients.entries()) {
            const destroyPromise = this.destroyClientInstance(clientId, client, 'shutdown');
            const timeoutPromise = new Promise((resolve) => setTimeout(resolve, this.envNumber('WA_SHUTDOWN_TIMEOUT_MS', 12000, 3000, 60000)));
            destructionPromises.push(Promise.race([destroyPromise, timeoutPromise]));
        }
        await Promise.all(destructionPromises);
        this.clients.clear();
    }
    async saveRegistry() {
        for (const config of this.configs.values()) {
            this.ensureIntegrationConfig(config);
        }
        const data = Object.fromEntries(this.configs);
        data.__global_settings__ = { apiStatus: this.apiStatus };
        await this.vault.snapshotRegistry({ reason: 'pre-registry-write', minIntervalMs: 5 * 60 * 1000 }).catch((error) => {
            console.warn('[session-vault] Registry snapshot skipped/failed before write:', error?.message || error);
        });
        await this.vault.atomicWriteJson(this.registryFile, data);
    }
    getAnyReadyClient() {
        for (const [id, status] of this.statuses.entries()) {
            if (status === 'ready') {
                const client = this.clients.get(id);
                if (client)
                    return { id, client };
            }
        }
        return null;
    }
    getOrCreateClient(clientId) {
        if (!this.clients.has(clientId))
            this.addClient(clientId);
        return this.clients.get(clientId);
    }
    addClient(clientId, saveToRegistry = true) {
        if (this.isShuttingDown)
            return;
        if (this.clients.has(clientId))
            return;
        if (this.initLocks.has(clientId))
            return;
        this.initLocks.add(clientId);
        if (saveToRegistry && !this.configs.has(clientId)) {
            this.configs.set(clientId, this.createDefaultConfig(clientId));
            this.saveRegistry().catch((error) => {
                console.error(`[${clientId}] Failed to save registry while adding client:`, error);
            });
        }
        else {
            const config = this.configs.get(clientId);
            if (config)
                this.ensureIntegrationConfig(config);
        }
        const health = this.ensureHealth(clientId);
        health.startedAt = Date.now();
        const client = new whatsapp_web_js_1.Client({
            authStrategy: new whatsapp_web_js_1.LocalAuth({ clientId, dataPath: this.authDir }),
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
        });
        (0, ReliableClientSend_1.installReliableClientSend)(client, clientId);
        this.clients.set(clientId, client);
        this.qrCodes.set(clientId, null);
        this.setRuntimeState(clientId, 'initializing', 'initializing');
        this.armReadyTimeout(clientId, 'initialization');
        client.on('qr', (qr) => {
            this.clearReadyTimeout(clientId);
            this.qrCodes.set(clientId, qr);
            this.qrUpdatedAt.set(clientId, Date.now());
            this.setRuntimeState(clientId, 'qr', 'qr_received');
        });
        client.on('authenticated', () => {
            this.qrCodes.set(clientId, null);
            this.setRuntimeState(clientId, 'authenticated', 'authenticated');
            this.armReadyTimeout(clientId, 'authenticated_waiting_for_ready');
        });
        client.on('ready', async () => {
            this.clearReadyTimeout(clientId);
            this.qrCodes.set(clientId, null);
            this.setRuntimeState(clientId, 'ready', 'ready');
            const readyHealth = this.ensureHealth(clientId);
            readyHealth.failedProbes = 0;
            readyHealth.isRecovering = false;
            readyHealth.readyAt = Date.now();
            readyHealth.lastGoodStateAt = Date.now();
            readyHealth.lastKnownState = 'CONNECTED';
            await this.vault.snapshotClientSession(clientId, 'ready', { minIntervalMs: this.envNumber('WA_SESSION_SNAPSHOT_MIN_INTERVAL_MS', 6 * 60 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000) }).catch((error) => {
                console.warn(`[${clientId}] Ready-state session snapshot skipped/failed:`, error?.message || error);
            });
            const config = this.configs.get(clientId);
            await CommandRegistry_1.default.reconcileAutomations(clientId, client, config?.commandFiles || []);
            console.log(`[${clientId}] Client is healthy and ready.`);
        });
        client.on('change_state', (state) => {
            const stateText = String(state || '');
            const stateHealth = this.ensureHealth(clientId);
            stateHealth.lastKnownState = stateText;
            stateHealth.lastProbeAt = Date.now();
            if (stateText === 'CONNECTED') {
                stateHealth.lastGoodStateAt = Date.now();
                if (this.runtimeStates.get(clientId) !== 'ready') {
                    this.setRuntimeState(clientId, 'ready', `change_state: ${stateText}`);
                }
            }
            else if (stateText === 'UNPAIRED' || stateText === 'UNPAIRED_IDLE') {
                this.clearReadyTimeout(clientId);
                this.setRuntimeState(clientId, 'unpaired', `change_state: ${stateText}`);
            }
        });
        client.on('auth_failure', (msg) => {
            this.clearReadyTimeout(clientId);
            console.error(`[${clientId}] Authentication failed. Session was not deleted: ${msg}`);
            this.setRuntimeState(clientId, 'error', `auth_failure: ${msg}`);
            const authHealth = this.ensureHealth(clientId);
            authHealth.failedProbes = 0;
        });
        client.on('disconnected', async (reason) => {
            console.log(`[${clientId}] Client disconnected. Reason: ${reason}`);
            this.clearReadyTimeout(clientId);
            await CommandRegistry_1.default.stopAutomations(clientId);
            this.setRuntimeState(clientId, 'degraded', `disconnected: ${reason}`);
            if (!this.isShuttingDown) {
                this.recoverClient(clientId, `Disconnected (${reason})`);
            }
        });
        client.on('message', async (msg) => {
            if (!msg.fromMe)
                await this.handleMessage(clientId, msg, client);
        });
        client.on('message_create', async (msg) => {
            if (msg.fromMe)
                await this.handleMessage(clientId, msg, client);
        });
        client.on?.('error', (error) => {
            console.error(`[${clientId}] Client emitted error:`, error);
            if (this.isBrowserCriticalError(error)) {
                this.recoverClient(clientId, `Browser/client error: ${error?.message || error}`);
            }
        });
        client.initialize()
            .then(() => {
            this.initLocks.delete(clientId);
        })
            .catch(async (err) => {
            console.error(`[${clientId}] Error initializing client:`, err);
            this.clearReadyTimeout(clientId);
            this.setRuntimeState(clientId, 'error', err.message || 'initialize_error');
            this.initLocks.delete(clientId);
            if (this.isBrowserCriticalError(err)) {
                await this.recoverClient(clientId, `Initialize browser failure: ${err.message || err}`);
            }
        });
    }
    async handleMessage(clientId, msg, client) {
        const config = this.configs.get(clientId);
        const commandsToRun = config?.commandFiles || [];
        const rules = config?.commandRules || {};
        await CommandRegistry_1.default.execute(commandsToRun, msg, client, rules);
    }
    async setCommands(clientId, commandFiles) {
        const config = this.configs.get(clientId);
        if (config) {
            config.commandFiles = commandFiles || [];
            this.ensureIntegrationConfig(config).updatedAt = Date.now();
            await this.saveRegistry();
            const client = this.clients.get(clientId);
            if (client && this.statuses.get(clientId) === 'ready') {
                await CommandRegistry_1.default.reconcileAutomations(clientId, client, config.commandFiles);
            }
        }
    }
    async setCommandRules(clientId, commandFile, include, exclude) {
        const config = this.configs.get(clientId);
        if (config) {
            if (!config.commandRules)
                config.commandRules = {};
            config.commandRules[commandFile] = { include: include || [], exclude: exclude || [] };
            const integration = this.ensureIntegrationConfig(config);
            integration.updatedAt = Date.now();
            integration.lastConfiguredAt = Date.now();
            await this.saveRegistry();
        }
    }
    async getChats(clientId) {
        const client = this.clients.get(clientId);
        if (!client || this.statuses.get(clientId) !== 'ready') {
            throw new Error('Client is not connected');
        }
        const chats = await client.getChats();
        return chats.map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            isGroup: c.isGroup
        }));
    }
    getRecentLogs(clientId, limit = 10) {
        return this.apiLogs.filter((log) => log.clientId === clientId).slice(0, limit);
    }
    verifyIntegrationToken(clientId, token) {
        const config = this.configs.get(clientId);
        if (!config || !token)
            return false;
        const integration = this.ensureIntegrationConfig(config);
        if (!integration.tokenHash)
            return false;
        return this.secureCompare(this.secretHash(token), integration.tokenHash);
    }
    verifyAdminIntegrationToken(token) {
        const configuredToken = Env_1.default.get('INTEGRATION_ADMIN_TOKEN');
        if (!configuredToken || !token)
            return false;
        return this.secureCompare(this.secretHash(token), this.secretHash(configuredToken));
    }
    getIntegrationDetails(clientId, baseUrl, includeActivity = false) {
        const config = this.configs.get(clientId);
        if (!config)
            return null;
        const integration = this.ensureIntegrationConfig(config);
        const status = this.statuses.get(clientId) || 'pending';
        const runtimeState = this.runtimeStates.get(clientId) || 'initializing';
        const statusDetail = this.statusDetails.get(clientId);
        const qrAvailable = Boolean(this.qrCodes.get(clientId));
        const health = this.healthData.get(clientId) || null;
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
        };
    }
    listIntegrationDetails(baseUrl) {
        return Array.from(this.configs.keys())
            .sort()
            .map((clientId) => this.getIntegrationDetails(clientId, baseUrl, true))
            .filter((detail) => Boolean(detail));
    }
    async registerIntegrationClient(input) {
        const idempotencyKeyHash = input.idempotencyKey ? this.secretHash(input.idempotencyKey) : undefined;
        let existingClientId = null;
        if (idempotencyKeyHash) {
            for (const [clientId, config] of this.configs.entries()) {
                if (this.ensureIntegrationConfig(config).idempotencyKeyHash === idempotencyKeyHash) {
                    existingClientId = clientId;
                    break;
                }
            }
        }
        if (!existingClientId && input.externalClientId) {
            for (const [clientId, config] of this.configs.entries()) {
                if (this.ensureIntegrationConfig(config).externalClientId === input.externalClientId) {
                    existingClientId = clientId;
                    break;
                }
            }
        }
        if (!existingClientId && input.clientId && this.configs.has(input.clientId)) {
            existingClientId = input.clientId;
        }
        const clientId = existingClientId || input.clientId || `instance_${(0, uuid_1.v4)().replace(/-/g, '').slice(0, 12)}`;
        let config = this.configs.get(clientId);
        let created = false;
        let token = null;
        if (!config) {
            config = this.createDefaultConfig(clientId);
            this.configs.set(clientId, config);
            created = true;
        }
        const integration = this.ensureIntegrationConfig(config);
        if (input.externalClientId)
            integration.externalClientId = input.externalClientId;
        if (input.displayName)
            integration.displayName = input.displayName;
        if (typeof input.webhookUrl === 'string')
            integration.webhookUrl = input.webhookUrl || undefined;
        if (Array.isArray(input.allowedOrigins))
            integration.allowedOrigins = input.allowedOrigins;
        if (input.metadata && typeof input.metadata === 'object')
            integration.metadata = input.metadata;
        if (idempotencyKeyHash && !integration.idempotencyKeyHash)
            integration.idempotencyKeyHash = idempotencyKeyHash;
        if (Array.isArray(input.commandFiles))
            config.commandFiles = input.commandFiles;
        if (input.commandRules && typeof input.commandRules === 'object')
            config.commandRules = input.commandRules;
        integration.updatedAt = Date.now();
        integration.lastConfiguredAt = Date.now();
        if (input.issueToken && !integration.tokenHash) {
            token = this.issueIntegrationToken(config);
        }
        await this.saveRegistry();
        this.addClient(clientId, false);
        return { clientId, created, idempotent: Boolean(existingClientId), token };
    }
    async updateIntegrationConfig(clientId, input) {
        const config = this.configs.get(clientId);
        if (!config)
            throw new Error(`Instance '${clientId}' does not exist`);
        const integration = this.ensureIntegrationConfig(config);
        if (typeof input.externalClientId === 'string')
            integration.externalClientId = input.externalClientId || undefined;
        if (typeof input.displayName === 'string')
            integration.displayName = input.displayName || undefined;
        if (typeof input.webhookUrl === 'string' || input.webhookUrl === null)
            integration.webhookUrl = input.webhookUrl || undefined;
        if (Array.isArray(input.allowedOrigins))
            integration.allowedOrigins = input.allowedOrigins;
        if (input.metadata && typeof input.metadata === 'object')
            integration.metadata = input.metadata;
        if (Array.isArray(input.commandFiles))
            config.commandFiles = input.commandFiles;
        if (input.commandRules && typeof input.commandRules === 'object')
            config.commandRules = input.commandRules;
        integration.updatedAt = Date.now();
        integration.lastConfiguredAt = Date.now();
        await this.saveRegistry();
        return config;
    }
    async rotateIntegrationToken(clientId) {
        const config = this.configs.get(clientId);
        if (!config)
            throw new Error(`Instance '${clientId}' does not exist`);
        const token = this.issueIntegrationToken(config, true);
        await this.saveRegistry();
        return token;
    }
    getQrState(clientId) {
        const config = this.configs.get(clientId);
        if (!config)
            return null;
        const status = this.statuses.get(clientId) || 'pending';
        const qr = this.qrCodes.get(clientId) || null;
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
        };
    }
    getDeliveryReceipt(clientId, idempotencyKey) {
        const config = this.configs.get(clientId);
        if (!config || !idempotencyKey)
            return null;
        const integration = this.ensureIntegrationConfig(config);
        const keyHash = this.secretHash(idempotencyKey);
        const now = Date.now();
        integration.deliveryReceipts = (integration.deliveryReceipts || []).filter((receipt) => receipt.expiresAt > now);
        return integration.deliveryReceipts.find((receipt) => receipt.keyHash === keyHash) || null;
    }
    async rememberDeliveryReceipt(clientId, idempotencyKey, statusCode, response) {
        const config = this.configs.get(clientId);
        if (!config || !idempotencyKey)
            return;
        const integration = this.ensureIntegrationConfig(config);
        const keyHash = this.secretHash(idempotencyKey);
        const now = Date.now();
        const receipts = (integration.deliveryReceipts || []).filter((receipt) => receipt.expiresAt > now && receipt.keyHash !== keyHash);
        receipts.unshift({
            keyHash,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
            statusCode,
            response
        });
        integration.deliveryReceipts = receipts.slice(0, 50);
        integration.updatedAt = now;
        await this.saveRegistry();
    }
    async reconnectClient(clientId) {
        if (!this.configs.has(clientId)) {
            throw new Error(`Instance '${clientId}' does not exist`);
        }
        if (!this.healthData.has(clientId)) {
            this.healthData.set(clientId, {
                failedProbes: 0,
                isRecovering: false,
                lastRecoveryAttempt: 0
            });
        }
        if (!this.clients.has(clientId)) {
            this.addClient(clientId, false);
            return;
        }
        await this.recoverClient(clientId, 'Manual reconnect requested');
    }
    async removeClient(clientId) {
        const client = this.clients.get(clientId);
        this.clearReadyTimeout(clientId);
        this.clearRecoveryTimer(clientId);
        if (client) {
            await this.destroyClientInstance(clientId, client, 'remove-client');
            this.clients.delete(clientId);
        }
        this.initLocks.delete(clientId);
        this.qrCodes.delete(clientId);
        this.qrUpdatedAt.delete(clientId);
        this.statuses.delete(clientId);
        this.runtimeStates.delete(clientId);
        this.statusDetails.delete(clientId);
        this.configs.delete(clientId);
        this.healthData.delete(clientId);
        await this.saveRegistry();
        const removePolicy = this.envString('WA_REMOVE_CLIENT_SESSION_POLICY', 'delete').toLowerCase();
        try {
            if (removePolicy === 'keep') {
                console.warn(`[${clientId}] Removed from registry but LocalAuth session was kept because WA_REMOVE_CLIENT_SESSION_POLICY=keep.`);
            }
            else if (removePolicy === 'quarantine') {
                await this.vault.quarantineClientSession(clientId, 'removed-from-manager');
            }
            else {
                await this.vault.deleteClientSession(clientId);
            }
        }
        catch (e) {
            console.error(`[${clientId}] Failed to apply LocalAuth removal policy '${removePolicy}':`, e?.message || e);
        }
    }
    runHealthChecks() {
        if (this.isShuttingDown)
            return;
        for (const [clientId, client] of this.clients.entries()) {
            this.checkClientHealth(clientId, client).catch(err => {
                console.error(`[${clientId}] Unexpected error in health check:`, err);
            });
        }
    }
    async checkClientHealth(clientId, client) {
        const health = this.ensureHealth(clientId);
        if (health.isRecovering)
            return;
        const runtimeState = this.runtimeStates.get(clientId) || 'initializing';
        health.lastProbeAt = Date.now();
        if (runtimeState === 'qr' || runtimeState === 'unpaired' || runtimeState === 'error' || runtimeState === 'fatal') {
            return;
        }
        if (runtimeState !== 'ready' && runtimeState !== 'degraded') {
            const startedAt = health.startedAt || this.statusDetails.get(clientId)?.updatedAt || Date.now();
            const timeoutMs = this.envNumber('WA_READY_TIMEOUT_MS', 120000, 30000, 900000);
            if (Date.now() - startedAt > timeoutMs) {
                await this.recoverClient(clientId, `Non-ready state '${runtimeState}' exceeded ${Math.round(timeoutMs / 1000)}s`);
            }
            return;
        }
        try {
            const probeTimeoutMs = this.envNumber('WA_PROBE_TIMEOUT_MS', 15000, 3000, 60000);
            const state = await Promise.race([
                client.getState(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), probeTimeoutMs))
            ]);
            health.lastKnownState = state;
            if (state === 'CONNECTED') {
                if (health.failedProbes > 0) {
                    console.log(`[${clientId}] Health recovered naturally. State: ${state}`);
                }
                health.failedProbes = 0;
                health.lastGoodStateAt = Date.now();
                if (this.runtimeStates.get(clientId) !== 'ready')
                    this.setRuntimeState(clientId, 'ready', 'probe_connected');
            }
            else if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
                console.error(`[${clientId}] Client is unpaired. Automated recovery stopped to preserve session files.`);
                this.setRuntimeState(clientId, 'unpaired', `probe_state: ${state}`);
                health.failedProbes = 0;
            }
            else {
                console.warn(`[${clientId}] Client degraded. State: ${state}`);
                this.setRuntimeState(clientId, 'degraded', `probe_state: ${state}`);
                health.failedProbes++;
            }
        }
        catch (error) {
            console.warn(`[${clientId}] Health probe failed (${health.failedProbes + 1}/${this.envNumber('WA_RECOVERY_FAILURE_THRESHOLD', 3, 1, 20)}): ${error.message}`);
            health.failedProbes++;
            if (this.runtimeStates.get(clientId) === 'ready') {
                this.setRuntimeState(clientId, 'degraded', `probe_failed: ${error.message}`);
            }
        }
        const threshold = this.envNumber('WA_RECOVERY_FAILURE_THRESHOLD', 3, 1, 20);
        if (health.failedProbes >= threshold && !health.isRecovering) {
            await this.recoverClient(clientId, `Stale/Unresponsive (${threshold} consecutive probe failures)`);
        }
    }
    async recoverClient(clientId, reason) {
        const health = this.ensureHealth(clientId);
        if (health.isRecovering)
            return;
        const now = Date.now();
        let delayBeforeRestart = this.envNumber('WA_RECOVERY_DELAY_MS', 5000, 1000, 300000);
        if (now - health.lastRecoveryAttempt < 2 * 60 * 1000) {
            const backoffMs = this.envNumber('WA_RECOVERY_BACKOFF_MS', 60000, 5000, 600000);
            console.warn(`[${clientId}] Recovery churn detected. Engaging ${Math.round(backoffMs / 1000)}s backoff.`);
            delayBeforeRestart = backoffMs;
        }
        health.isRecovering = true;
        health.lastRecoveryAttempt = now;
        health.failedProbes = 0;
        health.recoveryCount = (health.recoveryCount || 0) + 1;
        console.log(`[${clientId}] Initiating targeted recovery. Reason: ${reason}`);
        this.setRuntimeState(clientId, 'recovering', reason);
        this.clearReadyTimeout(clientId);
        this.clearRecoveryTimer(clientId);
        await this.vault.snapshotRegistry({ reason: `recovery-${clientId}`, minIntervalMs: 0 }).catch((error) => {
            console.warn(`[${clientId}] Registry snapshot before recovery failed:`, error?.message || error);
        });
        const client = this.clients.get(clientId);
        if (client) {
            await this.destroyClientInstance(clientId, client, `recovery-${reason}`);
        }
        this.clients.delete(clientId);
        this.initLocks.delete(clientId);
        const timer = setTimeout(() => {
            if (!this.isShuttingDown && this.configs.has(clientId)) {
                console.log(`[${clientId}] Restarting client instance post-recovery...`);
                health.isRecovering = false;
                health.startedAt = Date.now();
                this.addClient(clientId, false);
            }
            this.recoveryTimers.delete(clientId);
        }, delayBeforeRestart);
        if (typeof timer.unref === 'function')
            timer.unref();
        this.recoveryTimers.set(clientId, timer);
    }
}
exports.default = BotService;
BotService.processGuardsInstalled = false;
//# sourceMappingURL=BotService.js.map