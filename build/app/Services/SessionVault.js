"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
class SessionVault {
    constructor(dataDir, authDir, registryFile, limits) {
        this.dataDir = dataDir;
        this.authDir = authDir;
        this.registryFile = registryFile;
        this.limits = limits;
        this.lastRegistrySnapshotAt = 0;
        this.lastSessionSnapshotAt = new Map();
        this.writeQueue = Promise.resolve();
        this.backupRoot = path_1.default.join(this.dataDir, "backups");
        this.registryBackupDir = path_1.default.join(this.backupRoot, "registry");
        this.sessionBackupRoot = path_1.default.join(this.backupRoot, "sessions");
        this.quarantineRoot = path_1.default.join(this.backupRoot, "quarantine");
        this.limits = {
            retention: Math.max(0, this.limits?.retention ?? 3),
            maxBackupBytes: Math.max(0, this.limits?.maxBackupBytes ?? 512 * 1024 * 1024),
            maxBackupAgeMs: Math.max(0, this.limits?.maxBackupAgeMs ?? 7 * 24 * 60 * 60 * 1000),
        };
    }
    async ensure() {
        await fs_1.promises.mkdir(this.dataDir, { recursive: true });
        await fs_1.promises.mkdir(this.authDir, { recursive: true });
        await fs_1.promises.mkdir(this.registryBackupDir, { recursive: true });
        await fs_1.promises.mkdir(this.sessionBackupRoot, { recursive: true });
        await fs_1.promises.mkdir(this.quarantineRoot, { recursive: true });
    }
    async loadRegistry() {
        await this.ensure();
        try {
            const data = await this.readJsonObject(this.registryFile);
            return { data, restoredFromBackup: false, source: "primary" };
        }
        catch (primaryError) {
            if (primaryError && primaryError.code === "ENOENT") {
                return { data: {}, restoredFromBackup: false, source: "empty" };
            }
            console.error(`[session-vault] clients.json is not readable. Attempting restore from backup: ${primaryError?.message || primaryError}`);
            const backup = await this.findLatestValidRegistryBackup();
            if (!backup) {
                await this.quarantineFile(this.registryFile, "corrupt-clients-json");
                return { data: {}, restoredFromBackup: false, source: "empty" };
            }
            const data = await this.readJsonObject(backup);
            await this.atomicWriteFile(this.registryFile, JSON.stringify(data, null, 2));
            console.warn(`[session-vault] Restored clients.json from ${backup}`);
            return { data, restoredFromBackup: true, source: "backup" };
        }
    }
    async atomicWriteJson(filePath, value) {
        const payload = JSON.stringify(value, null, 2);
        this.writeQueue = this.writeQueue.then(() => this.atomicWriteFile(filePath, payload));
        return this.writeQueue;
    }
    async snapshotRegistry(options) {
        await this.ensure();
        const now = Date.now();
        const minInterval = options.minIntervalMs ?? 0;
        if (minInterval > 0 && now - this.lastRegistrySnapshotAt < minInterval)
            return null;
        if (!(await this.exists(this.registryFile)))
            return null;
        const backupPath = path_1.default.join(this.registryBackupDir, `clients-${this.timestamp()}-${this.safeReason(options.reason)}.json`);
        await fs_1.promises.copyFile(this.registryFile, backupPath);
        this.lastRegistrySnapshotAt = now;
        await this.pruneDirectory(this.registryBackupDir, this.limits.retention);
        await this.cleanupBackups();
        return backupPath;
    }
    async snapshotClientSession(clientId, reason, options = {}) {
        await this.ensure();
        const source = this.sessionPath(clientId);
        if (!(await this.isUsableDirectory(source)))
            return null;
        const now = Date.now();
        const minInterval = options.minIntervalMs ?? 0;
        const throttleKey = `${clientId}:${this.safeReason(reason)}`;
        const lastSnapshotAt = this.lastSessionSnapshotAt.get(throttleKey) || 0;
        if (minInterval > 0 && now - lastSnapshotAt < minInterval)
            return null;
        const clientBackupRoot = path_1.default.join(this.sessionBackupRoot, clientId);
        await fs_1.promises.mkdir(clientBackupRoot, { recursive: true });
        const destination = path_1.default.join(clientBackupRoot, `${this.timestamp()}-${this.safeReason(reason)}`);
        await this.copyDirectory(source, destination);
        this.lastSessionSnapshotAt.set(throttleKey, now);
        await this.pruneDirectory(clientBackupRoot, this.limits.retention);
        await this.cleanupBackups();
        return destination;
    }
    async deleteClientSession(clientId) {
        const source = this.sessionPath(clientId);
        if (!(await this.exists(source)))
            return false;
        await fs_1.promises.rm(source, { recursive: true, force: true });
        return true;
    }
    async restoreLatestClientSession(clientId, reason) {
        await this.ensure();
        const latest = await this.findLatestClientSnapshot(clientId);
        if (!latest)
            return false;
        const target = this.sessionPath(clientId);
        if (await this.exists(target)) {
            const quarantineTarget = path_1.default.join(this.quarantineRoot, `${clientId}-${this.timestamp()}-${this.safeReason(reason)}`);
            await fs_1.promises.mkdir(path_1.default.dirname(quarantineTarget), { recursive: true });
            await fs_1.promises.rename(target, quarantineTarget).catch(async () => {
                await this.copyDirectory(target, quarantineTarget);
                await fs_1.promises.rm(target, { recursive: true, force: true });
            });
        }
        await this.copyDirectory(latest, target);
        console.warn(`[session-vault] Restored LocalAuth folder for ${clientId} from ${latest}`);
        return true;
    }
    async ensureClientSessionIfRecoverable(clientId) {
        const sessionDir = this.sessionPath(clientId);
        if (await this.isUsableDirectory(sessionDir))
            return "ready";
        const restored = await this.restoreLatestClientSession(clientId, "missing-session-on-startup");
        return restored ? "restored" : "missing";
    }
    async quarantineClientSession(clientId, reason) {
        await this.ensure();
        const source = this.sessionPath(clientId);
        if (!(await this.exists(source)))
            return null;
        const quarantineTarget = path_1.default.join(this.quarantineRoot, `${clientId}-${this.timestamp()}-${this.safeReason(reason)}`);
        await fs_1.promises.mkdir(path_1.default.dirname(quarantineTarget), { recursive: true });
        await fs_1.promises.rename(source, quarantineTarget).catch(async () => {
            await this.copyDirectory(source, quarantineTarget);
            await fs_1.promises.rm(source, { recursive: true, force: true });
        });
        await this.cleanupBackups();
        return quarantineTarget;
    }
    sessionPath(clientId) {
        return path_1.default.join(this.authDir, `session-${clientId}`);
    }
    async readJsonObject(filePath) {
        const raw = await fs_1.promises.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`${filePath} must contain a JSON object`);
        }
        return parsed;
    }
    async atomicWriteFile(filePath, payload) {
        await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        const handle = await fs_1.promises.open(tempPath, "w");
        try {
            await handle.writeFile(payload, "utf-8");
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await fs_1.promises.rename(tempPath, filePath);
    }
    async findLatestValidRegistryBackup() {
        const files = await this.sortedChildren(this.registryBackupDir);
        for (const file of files.reverse()) {
            const fullPath = path_1.default.join(this.registryBackupDir, file);
            try {
                await this.readJsonObject(fullPath);
                return fullPath;
            }
            catch (_) { }
        }
        return null;
    }
    async findLatestClientSnapshot(clientId) {
        const root = path_1.default.join(this.sessionBackupRoot, clientId);
        const children = await this.sortedChildren(root);
        for (const child of children.reverse()) {
            const fullPath = path_1.default.join(root, child);
            if (await this.isUsableDirectory(fullPath))
                return fullPath;
        }
        return null;
    }
    async quarantineFile(filePath, reason) {
        if (!(await this.exists(filePath)))
            return;
        const quarantineTarget = path_1.default.join(this.quarantineRoot, `${path_1.default.basename(filePath)}-${this.timestamp()}-${this.safeReason(reason)}`);
        await fs_1.promises.mkdir(path_1.default.dirname(quarantineTarget), { recursive: true });
        await fs_1.promises.rename(filePath, quarantineTarget).catch(() => null);
    }
    async copyDirectory(source, destination) {
        await fs_1.promises.mkdir(destination, { recursive: true });
        const entries = await fs_1.promises.readdir(source, { withFileTypes: true });
        for (const entry of entries) {
            if (this.shouldSkipProfileEntry(entry.name))
                continue;
            const sourcePath = path_1.default.join(source, entry.name);
            const destinationPath = path_1.default.join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirectory(sourcePath, destinationPath);
            }
            else if (entry.isFile()) {
                await fs_1.promises.mkdir(path_1.default.dirname(destinationPath), { recursive: true });
                await fs_1.promises.copyFile(sourcePath, destinationPath).catch((error) => {
                    console.warn(`[session-vault] Skipped file during session snapshot: ${sourcePath}: ${error?.message || error}`);
                });
            }
        }
    }
    shouldSkipProfileEntry(name) {
        return [
            "SingletonLock",
            "SingletonCookie",
            "SingletonSocket",
            "DevToolsActivePort",
            "CrashpadMetrics-active.pma",
            "Cache",
            "Code Cache",
            "GPUCache",
            "Crashpad",
            "BrowserMetrics",
            "GrShaderCache",
            "ShaderCache",
            "DawnCache",
        ].includes(name);
    }
    async pruneDirectory(directory, keep) {
        const children = await this.sortedChildren(directory);
        const stale = children.slice(0, Math.max(0, children.length - keep));
        for (const child of stale) {
            await fs_1.promises
                .rm(path_1.default.join(directory, child), { recursive: true, force: true })
                .catch(() => null);
        }
    }
    async sortedChildren(directory) {
        try {
            const entries = await fs_1.promises.readdir(directory, { withFileTypes: true });
            const withStats = await Promise.all(entries.map(async (entry) => {
                const fullPath = path_1.default.join(directory, entry.name);
                const stat = await fs_1.promises.stat(fullPath).catch(() => null);
                return { name: entry.name, mtimeMs: stat?.mtimeMs || 0 };
            }));
            return withStats
                .sort((a, b) => a.mtimeMs - b.mtimeMs)
                .map((entry) => entry.name);
        }
        catch (_) {
            return [];
        }
    }
    async isUsableDirectory(directory) {
        try {
            const stat = await fs_1.promises.stat(directory);
            if (!stat.isDirectory())
                return false;
            const entries = await fs_1.promises.readdir(directory);
            return entries.length > 0;
        }
        catch (_) {
            return false;
        }
    }
    async exists(filePath) {
        try {
            await fs_1.promises.access(filePath);
            return true;
        }
        catch (_) {
            return false;
        }
    }
    async cleanupBackups() {
        if (!(await this.exists(this.backupRoot)))
            return;
        const files = await this.collectFiles(this.backupRoot);
        const now = Date.now();
        if (this.limits.maxBackupAgeMs > 0) {
            await Promise.all(files
                .filter((file) => now - file.mtimeMs > this.limits.maxBackupAgeMs)
                .map((file) => fs_1.promises.rm(file.path, { force: true }).catch(() => null)));
        }
        if (this.limits.maxBackupBytes <= 0)
            return;
        const remaining = await this.collectFiles(this.backupRoot);
        let totalBytes = remaining.reduce((sum, file) => sum + file.size, 0);
        for (const file of remaining.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
            if (totalBytes <= this.limits.maxBackupBytes)
                break;
            await fs_1.promises.rm(file.path, { force: true }).catch(() => null);
            totalBytes -= file.size;
        }
    }
    async collectFiles(directory) {
        const results = [];
        const walk = async (current) => {
            let entries;
            try {
                entries = await fs_1.promises.readdir(current, { withFileTypes: true });
            }
            catch (_) {
                return;
            }
            for (const entry of entries) {
                const fullPath = path_1.default.join(current, entry.name);
                const stat = await fs_1.promises.stat(fullPath).catch(() => null);
                if (!stat)
                    continue;
                if (entry.isDirectory()) {
                    await walk(fullPath);
                }
                else if (entry.isFile()) {
                    results.push({
                        path: fullPath,
                        size: stat.size,
                        mtimeMs: stat.mtimeMs,
                    });
                }
            }
        };
        await walk(directory);
        return results;
    }
    timestamp() {
        return new Date().toISOString().replace(/[:.]/g, "-");
    }
    safeReason(reason) {
        return ((reason || "snapshot")
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "snapshot");
    }
}
exports.default = SessionVault;
//# sourceMappingURL=SessionVault.js.map