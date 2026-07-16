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
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (!value || typeof value !== 'object')
        return value;
    const output = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined)
            output[key] = stableValue(value[key]);
    }
    return output;
}
function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
class ApiSendGuard {
    constructor() {
        this.entries = new Map();
        this.inFlight = new Map();
        this.loaded = false;
        this.loading = null;
        this.writing = Promise.resolve();
    }
    get storagePath() {
        return path.join(Env_1.default.get('WA_SESSION_DIR'), 'api-send-idempotency.json');
    }
    createKey(scope, payload, explicitKey) {
        if (explicitKey && explicitKey.trim()) {
            return {
                key: `explicit:${sha256(`${scope}:${explicitKey.trim()}`)}`,
                keyType: 'explicit',
            };
        }
        const serialized = JSON.stringify(stableValue({ scope, payload }));
        return {
            key: `automatic:${sha256(serialized)}`,
            keyType: 'automatic',
        };
    }
    async ensureLoaded() {
        if (this.loaded)
            return;
        if (this.loading)
            return this.loading;
        this.loading = (async () => {
            try {
                const raw = await fs.promises.readFile(this.storagePath, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed?.entries)) {
                    const now = Date.now();
                    for (const item of parsed.entries) {
                        const validState = item?.state === 'processing' || item?.state === 'completed';
                        const validCompletedResult = item?.state !== 'completed' || (item.result && typeof item.result.statusCode === 'number');
                        if (item &&
                            typeof item.key === 'string' &&
                            validState &&
                            validCompletedResult &&
                            typeof item.expiresAt === 'number' &&
                            item.expiresAt > now) {
                            this.entries.set(item.key, item);
                        }
                    }
                }
            }
            catch (error) {
                if (error?.code !== 'ENOENT') {
                    console.error('[api-send-guard] Unable to read idempotency ledger:', error);
                }
            }
            finally {
                this.loaded = true;
                this.loading = null;
            }
        })();
        return this.loading;
    }
    cleanup(now = Date.now()) {
        for (const [key, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now)
                this.entries.delete(key);
        }
    }
    async persist() {
        const snapshot = Array.from(this.entries.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 10000);
        this.entries = new Map(snapshot.map((entry) => [entry.key, entry]));
        this.writing = this.writing
            .catch(() => undefined)
            .then(async () => {
            const destination = this.storagePath;
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            const temporary = `${destination}.${process.pid}.tmp`;
            await fs.promises.writeFile(temporary, JSON.stringify({ version: 2, entries: snapshot }, null, 2), 'utf8');
            await fs.promises.rename(temporary, destination);
        });
        await this.writing;
    }
    processingReplay(expiresAt) {
        return {
            statusCode: 202,
            body: {
                status: 'pending',
                success: true,
                duplicateSuppressed: true,
                message: 'An identical send request is already recorded. WhatsApp was not called again.',
                delivery: {
                    confirmed: 0,
                    submitted: 0,
                    retriesPerformed: 0,
                },
                keyExpiresAt: expiresAt,
            },
        };
    }
    async execute(key, keyType, ttlMs, operation) {
        await this.ensureLoaded();
        const now = Date.now();
        this.cleanup(now);
        const stored = this.entries.get(key);
        if (stored) {
            if (stored.state === 'completed' && stored.result) {
                return {
                    result: stored.result,
                    replayed: true,
                    expiresAt: stored.expiresAt,
                    keyType,
                };
            }
            return {
                result: this.processingReplay(stored.expiresAt),
                replayed: true,
                expiresAt: stored.expiresAt,
                keyType,
            };
        }
        const running = this.inFlight.get(key);
        if (running) {
            const shared = await running;
            return { ...shared, replayed: true };
        }
        const createdAt = Date.now();
        const expiresAt = createdAt + ttlMs;
        this.entries.set(key, {
            key,
            state: 'processing',
            createdAt,
            expiresAt,
        });
        await this.persist();
        const task = (async () => {
            let result;
            try {
                result = await operation();
            }
            catch (error) {
                result = {
                    statusCode: 500,
                    body: {
                        status: 'error',
                        success: false,
                        error: error?.message || String(error),
                        retriesPerformed: 0,
                    },
                };
            }
            this.entries.set(key, {
                key,
                state: 'completed',
                createdAt,
                expiresAt,
                result,
            });
            await this.persist();
            return { result, replayed: false, expiresAt, keyType };
        })();
        this.inFlight.set(key, task);
        try {
            return await task;
        }
        finally {
            if (this.inFlight.get(key) === task)
                this.inFlight.delete(key);
        }
    }
}
exports.default = new ApiSendGuard();
//# sourceMappingURL=ApiSendGuard.js.map