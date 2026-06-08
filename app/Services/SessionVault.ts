import { promises as fs } from "fs";
import path from "path";

export type SnapshotKind = "registry" | "session";

export interface SnapshotOptions {
  reason: string;
  minIntervalMs?: number;
}

export interface VaultLimits {
  retention: number;
  maxBackupBytes: number;
  maxBackupAgeMs: number;
}

export interface RegistryLoadResult {
  data: Record<string, any>;
  restoredFromBackup: boolean;
  source: "primary" | "backup" | "empty";
}

export default class SessionVault {
  private backupRoot: string;
  private registryBackupDir: string;
  private sessionBackupRoot: string;
  private quarantineRoot: string;
  private lastRegistrySnapshotAt = 0;
  private lastSessionSnapshotAt: Map<string, number> = new Map();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private dataDir: string,
    private authDir: string,
    private registryFile: string,
    private limits: VaultLimits,
  ) {
    this.backupRoot = path.join(this.dataDir, "backups");
    this.registryBackupDir = path.join(this.backupRoot, "registry");
    this.sessionBackupRoot = path.join(this.backupRoot, "sessions");
    this.quarantineRoot = path.join(this.backupRoot, "quarantine");
    this.limits = {
      retention: Math.max(0, this.limits?.retention ?? 3),
      maxBackupBytes: Math.max(
        0,
        this.limits?.maxBackupBytes ?? 512 * 1024 * 1024,
      ),
      maxBackupAgeMs: Math.max(
        0,
        this.limits?.maxBackupAgeMs ?? 7 * 24 * 60 * 60 * 1000,
      ),
    };
  }

  public async ensure(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.authDir, { recursive: true });
    await fs.mkdir(this.registryBackupDir, { recursive: true });
    await fs.mkdir(this.sessionBackupRoot, { recursive: true });
    await fs.mkdir(this.quarantineRoot, { recursive: true });
  }

  public async loadRegistry(): Promise<RegistryLoadResult> {
    await this.ensure();

    try {
      const data = await this.readJsonObject(this.registryFile);
      return { data, restoredFromBackup: false, source: "primary" };
    } catch (primaryError: any) {
      if (primaryError && primaryError.code === "ENOENT") {
        return { data: {}, restoredFromBackup: false, source: "empty" };
      }

      console.error(
        `[session-vault] clients.json is not readable. Attempting restore from backup: ${primaryError?.message || primaryError}`,
      );
      const backup = await this.findLatestValidRegistryBackup();
      if (!backup) {
        await this.quarantineFile(this.registryFile, "corrupt-clients-json");
        return { data: {}, restoredFromBackup: false, source: "empty" };
      }

      const data = await this.readJsonObject(backup);
      await this.atomicWriteFile(
        this.registryFile,
        JSON.stringify(data, null, 2),
      );
      console.warn(`[session-vault] Restored clients.json from ${backup}`);
      return { data, restoredFromBackup: true, source: "backup" };
    }
  }

  public async atomicWriteJson(filePath: string, value: any): Promise<void> {
    const payload = JSON.stringify(value, null, 2);
    this.writeQueue = this.writeQueue.then(() =>
      this.atomicWriteFile(filePath, payload),
    );
    return this.writeQueue;
  }

  public async snapshotRegistry(
    options: SnapshotOptions,
  ): Promise<string | null> {
    await this.ensure();
    const now = Date.now();
    const minInterval = options.minIntervalMs ?? 0;
    if (minInterval > 0 && now - this.lastRegistrySnapshotAt < minInterval)
      return null;

    if (!(await this.exists(this.registryFile))) return null;

    const backupPath = path.join(
      this.registryBackupDir,
      `clients-${this.timestamp()}-${this.safeReason(options.reason)}.json`,
    );
    await fs.copyFile(this.registryFile, backupPath);
    this.lastRegistrySnapshotAt = now;
    await this.pruneDirectory(this.registryBackupDir, this.limits.retention);
    await this.cleanupBackups();
    return backupPath;
  }

  public async snapshotClientSession(
    clientId: string,
    reason: string,
    options: Omit<SnapshotOptions, "reason"> = {},
  ): Promise<string | null> {
    await this.ensure();
    const source = this.sessionPath(clientId);
    if (!(await this.isUsableDirectory(source))) return null;

    const now = Date.now();
    const minInterval = options.minIntervalMs ?? 0;
    const throttleKey = `${clientId}:${this.safeReason(reason)}`;
    const lastSnapshotAt = this.lastSessionSnapshotAt.get(throttleKey) || 0;
    if (minInterval > 0 && now - lastSnapshotAt < minInterval) return null;

    const clientBackupRoot = path.join(this.sessionBackupRoot, clientId);
    await fs.mkdir(clientBackupRoot, { recursive: true });
    const destination = path.join(
      clientBackupRoot,
      `${this.timestamp()}-${this.safeReason(reason)}`,
    );
    await this.copyDirectory(source, destination);
    this.lastSessionSnapshotAt.set(throttleKey, now);
    await this.pruneDirectory(clientBackupRoot, this.limits.retention);
    await this.cleanupBackups();
    return destination;
  }

  public async deleteClientSession(clientId: string): Promise<boolean> {
    const source = this.sessionPath(clientId);
    if (!(await this.exists(source))) return false;
    await fs.rm(source, { recursive: true, force: true });
    return true;
  }

  public async restoreLatestClientSession(
    clientId: string,
    reason: string,
  ): Promise<boolean> {
    await this.ensure();
    const latest = await this.findLatestClientSnapshot(clientId);
    if (!latest) return false;

    const target = this.sessionPath(clientId);
    if (await this.exists(target)) {
      const quarantineTarget = path.join(
        this.quarantineRoot,
        `${clientId}-${this.timestamp()}-${this.safeReason(reason)}`,
      );
      await fs.mkdir(path.dirname(quarantineTarget), { recursive: true });
      await fs.rename(target, quarantineTarget).catch(async () => {
        await this.copyDirectory(target, quarantineTarget);
        await fs.rm(target, { recursive: true, force: true });
      });
    }

    await this.copyDirectory(latest, target);
    console.warn(
      `[session-vault] Restored LocalAuth folder for ${clientId} from ${latest}`,
    );
    return true;
  }

  public async ensureClientSessionIfRecoverable(
    clientId: string,
  ): Promise<"ready" | "restored" | "missing"> {
    const sessionDir = this.sessionPath(clientId);
    if (await this.isUsableDirectory(sessionDir)) return "ready";

    const restored = await this.restoreLatestClientSession(
      clientId,
      "missing-session-on-startup",
    );
    return restored ? "restored" : "missing";
  }

  public async quarantineClientSession(
    clientId: string,
    reason: string,
  ): Promise<string | null> {
    await this.ensure();
    const source = this.sessionPath(clientId);
    if (!(await this.exists(source))) return null;

    const quarantineTarget = path.join(
      this.quarantineRoot,
      `${clientId}-${this.timestamp()}-${this.safeReason(reason)}`,
    );
    await fs.mkdir(path.dirname(quarantineTarget), { recursive: true });
    await fs.rename(source, quarantineTarget).catch(async () => {
      await this.copyDirectory(source, quarantineTarget);
      await fs.rm(source, { recursive: true, force: true });
    });
    await this.cleanupBackups();
    return quarantineTarget;
  }

  public sessionPath(clientId: string): string {
    return path.join(this.authDir, `session-${clientId}`);
  }

  private async readJsonObject(filePath: string): Promise<Record<string, any>> {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON object`);
    }
    return parsed;
  }

  private async atomicWriteFile(
    filePath: string,
    payload: string,
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(tempPath, "w");
    try {
      await handle.writeFile(payload, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, filePath);
  }

  private async findLatestValidRegistryBackup(): Promise<string | null> {
    const files = await this.sortedChildren(this.registryBackupDir);
    for (const file of files.reverse()) {
      const fullPath = path.join(this.registryBackupDir, file);
      try {
        await this.readJsonObject(fullPath);
        return fullPath;
      } catch (_) {}
    }
    return null;
  }

  private async findLatestClientSnapshot(
    clientId: string,
  ): Promise<string | null> {
    const root = path.join(this.sessionBackupRoot, clientId);
    const children = await this.sortedChildren(root);
    for (const child of children.reverse()) {
      const fullPath = path.join(root, child);
      if (await this.isUsableDirectory(fullPath)) return fullPath;
    }
    return null;
  }

  private async quarantineFile(
    filePath: string,
    reason: string,
  ): Promise<void> {
    if (!(await this.exists(filePath))) return;
    const quarantineTarget = path.join(
      this.quarantineRoot,
      `${path.basename(filePath)}-${this.timestamp()}-${this.safeReason(reason)}`,
    );
    await fs.mkdir(path.dirname(quarantineTarget), { recursive: true });
    await fs.rename(filePath, quarantineTarget).catch(() => null);
  }

  private async copyDirectory(
    source: string,
    destination: string,
  ): Promise<void> {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (this.shouldSkipProfileEntry(entry.name)) continue;

      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath).catch((error: any) => {
          console.warn(
            `[session-vault] Skipped file during session snapshot: ${sourcePath}: ${error?.message || error}`,
          );
        });
      }
    }
  }

  private shouldSkipProfileEntry(name: string): boolean {
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

  private async pruneDirectory(directory: string, keep: number): Promise<void> {
    const children = await this.sortedChildren(directory);
    const stale = children.slice(0, Math.max(0, children.length - keep));
    for (const child of stale) {
      await fs
        .rm(path.join(directory, child), { recursive: true, force: true })
        .catch(() => null);
    }
  }

  private async sortedChildren(directory: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const withStats = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(directory, entry.name);
          const stat = await fs.stat(fullPath).catch(() => null);
          return { name: entry.name, mtimeMs: stat?.mtimeMs || 0 };
        }),
      );
      return withStats
        .sort((a, b) => a.mtimeMs - b.mtimeMs)
        .map((entry) => entry.name);
    } catch (_) {
      return [];
    }
  }

  private async isUsableDirectory(directory: string): Promise<boolean> {
    try {
      const stat = await fs.stat(directory);
      if (!stat.isDirectory()) return false;
      const entries = await fs.readdir(directory);
      return entries.length > 0;
    } catch (_) {
      return false;
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch (_) {
      return false;
    }
  }

  private async cleanupBackups(): Promise<void> {
    if (!(await this.exists(this.backupRoot))) return;

    const files = await this.collectFiles(this.backupRoot);
    const now = Date.now();

    if (this.limits.maxBackupAgeMs > 0) {
      await Promise.all(
        files
          .filter((file) => now - file.mtimeMs > this.limits.maxBackupAgeMs)
          .map((file) => fs.rm(file.path, { force: true }).catch(() => null)),
      );
    }

    if (this.limits.maxBackupBytes <= 0) return;

    const remaining = await this.collectFiles(this.backupRoot);
    let totalBytes = remaining.reduce((sum, file) => sum + file.size, 0);
    for (const file of remaining.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (totalBytes <= this.limits.maxBackupBytes) break;
      await fs.rm(file.path, { force: true }).catch(() => null);
      totalBytes -= file.size;
    }
  }

  private async collectFiles(
    directory: string,
  ): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
    const results: Array<{ path: string; size: number; mtimeMs: number }> = [];

    const walk = async (current: string) => {
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat) continue;
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
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

  private timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  private safeReason(reason: string): string {
    return (
      (reason || "snapshot")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "snapshot"
    );
  }
}
