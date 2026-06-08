import { promises as fs } from 'fs'
import path from 'path'

export type SnapshotKind = 'registry' | 'session'

export interface SnapshotOptions {
  reason: string;
  minIntervalMs?: number;
}

export interface RegistryLoadResult {
  data: Record<string, any>;
  restoredFromBackup: boolean;
  source: 'primary' | 'backup' | 'empty';
}

export default class SessionVault {
  private backupRoot: string
  private registryBackupDir: string
  private sessionBackupRoot: string
  private quarantineRoot: string
  private lastRegistrySnapshotAt = 0
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private dataDir: string,
    private authDir: string,
    private registryFile: string,
    private retention: number
  ) {
    this.backupRoot = path.join(this.dataDir, 'backups')
    this.registryBackupDir = path.join(this.backupRoot, 'registry')
    this.sessionBackupRoot = path.join(this.backupRoot, 'sessions')
    this.quarantineRoot = path.join(this.backupRoot, 'quarantine')
    this.retention = Math.max(3, this.retention || 10)
  }

  public async ensure(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true })
    await fs.mkdir(this.authDir, { recursive: true })
    await fs.mkdir(this.registryBackupDir, { recursive: true })
    await fs.mkdir(this.sessionBackupRoot, { recursive: true })
    await fs.mkdir(this.quarantineRoot, { recursive: true })
  }

  public async loadRegistry(): Promise<RegistryLoadResult> {
    await this.ensure()

    try {
      const data = await this.readJsonObject(this.registryFile)
      return { data, restoredFromBackup: false, source: 'primary' }
    } catch (primaryError: any) {
      if (primaryError && primaryError.code === 'ENOENT') {
        return { data: {}, restoredFromBackup: false, source: 'empty' }
      }

      console.error(`[session-vault] clients.json is not readable. Attempting restore from backup: ${primaryError?.message || primaryError}`)
      const backup = await this.findLatestValidRegistryBackup()
      if (!backup) {
        await this.quarantineFile(this.registryFile, 'corrupt-clients-json')
        return { data: {}, restoredFromBackup: false, source: 'empty' }
      }

      const data = await this.readJsonObject(backup)
      await this.atomicWriteFile(this.registryFile, JSON.stringify(data, null, 2))
      console.warn(`[session-vault] Restored clients.json from ${backup}`)
      return { data, restoredFromBackup: true, source: 'backup' }
    }
  }

  public async atomicWriteJson(filePath: string, value: any): Promise<void> {
    const payload = JSON.stringify(value, null, 2)
    this.writeQueue = this.writeQueue.then(() => this.atomicWriteFile(filePath, payload))
    return this.writeQueue
  }

  public async snapshotRegistry(options: SnapshotOptions): Promise<string | null> {
    await this.ensure()
    const now = Date.now()
    const minInterval = options.minIntervalMs ?? 0
    if (minInterval > 0 && now - this.lastRegistrySnapshotAt < minInterval) return null

    if (!(await this.exists(this.registryFile))) return null

    const backupPath = path.join(
      this.registryBackupDir,
      `clients-${this.timestamp()}-${this.safeReason(options.reason)}.json`
    )
    await fs.copyFile(this.registryFile, backupPath)
    this.lastRegistrySnapshotAt = now
    await this.pruneDirectory(this.registryBackupDir, this.retention)
    return backupPath
  }

  public async snapshotClientSession(clientId: string, reason: string): Promise<string | null> {
    await this.ensure()
    const source = this.sessionPath(clientId)
    if (!(await this.isUsableDirectory(source))) return null

    const clientBackupRoot = path.join(this.sessionBackupRoot, clientId)
    await fs.mkdir(clientBackupRoot, { recursive: true })
    const destination = path.join(clientBackupRoot, `${this.timestamp()}-${this.safeReason(reason)}`)
    await this.copyDirectory(source, destination)
    await this.pruneDirectory(clientBackupRoot, this.retention)
    return destination
  }

  public async restoreLatestClientSession(clientId: string, reason: string): Promise<boolean> {
    await this.ensure()
    const latest = await this.findLatestClientSnapshot(clientId)
    if (!latest) return false

    const target = this.sessionPath(clientId)
    if (await this.exists(target)) {
      const quarantineTarget = path.join(
        this.quarantineRoot,
        `${clientId}-${this.timestamp()}-${this.safeReason(reason)}`
      )
      await fs.mkdir(path.dirname(quarantineTarget), { recursive: true })
      await fs.rename(target, quarantineTarget).catch(async () => {
        await this.copyDirectory(target, quarantineTarget)
        await fs.rm(target, { recursive: true, force: true })
      })
    }

    await this.copyDirectory(latest, target)
    console.warn(`[session-vault] Restored LocalAuth folder for ${clientId} from ${latest}`)
    return true
  }

  public async ensureClientSessionIfRecoverable(clientId: string): Promise<'ready' | 'restored' | 'missing'> {
    const sessionDir = this.sessionPath(clientId)
    if (await this.isUsableDirectory(sessionDir)) return 'ready'

    const restored = await this.restoreLatestClientSession(clientId, 'missing-session-on-startup')
    return restored ? 'restored' : 'missing'
  }


  public async quarantineClientSession(clientId: string, reason: string): Promise<string | null> {
    await this.ensure()
    const source = this.sessionPath(clientId)
    if (!(await this.exists(source))) return null

    const quarantineTarget = path.join(
      this.quarantineRoot,
      `${clientId}-${this.timestamp()}-${this.safeReason(reason)}`
    )
    await fs.mkdir(path.dirname(quarantineTarget), { recursive: true })
    await fs.rename(source, quarantineTarget).catch(async () => {
      await this.copyDirectory(source, quarantineTarget)
      await fs.rm(source, { recursive: true, force: true })
    })
    return quarantineTarget
  }

  public sessionPath(clientId: string): string {
    return path.join(this.authDir, `session-${clientId}`)
  }

  private async readJsonObject(filePath: string): Promise<Record<string, any>> {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON object`)
    }
    return parsed
  }

  private async atomicWriteFile(filePath: string, payload: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    const handle = await fs.open(tempPath, 'w')
    try {
      await handle.writeFile(payload, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tempPath, filePath)
  }

  private async findLatestValidRegistryBackup(): Promise<string | null> {
    const files = await this.sortedChildren(this.registryBackupDir)
    for (const file of files.reverse()) {
      const fullPath = path.join(this.registryBackupDir, file)
      try {
        await this.readJsonObject(fullPath)
        return fullPath
      } catch (_) {}
    }
    return null
  }

  private async findLatestClientSnapshot(clientId: string): Promise<string | null> {
    const root = path.join(this.sessionBackupRoot, clientId)
    const children = await this.sortedChildren(root)
    for (const child of children.reverse()) {
      const fullPath = path.join(root, child)
      if (await this.isUsableDirectory(fullPath)) return fullPath
    }
    return null
  }

  private async quarantineFile(filePath: string, reason: string): Promise<void> {
    if (!(await this.exists(filePath))) return
    const quarantineTarget = path.join(
      this.quarantineRoot,
      `${path.basename(filePath)}-${this.timestamp()}-${this.safeReason(reason)}`
    )
    await fs.mkdir(path.dirname(quarantineTarget), { recursive: true })
    await fs.rename(filePath, quarantineTarget).catch(() => null)
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    await fs.mkdir(destination, { recursive: true })
    const entries = await fs.readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      if (this.shouldSkipProfileEntry(entry.name)) continue

      const sourcePath = path.join(source, entry.name)
      const destinationPath = path.join(destination, entry.name)

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destinationPath)
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true })
        await fs.copyFile(sourcePath, destinationPath).catch((error: any) => {
          console.warn(`[session-vault] Skipped file during session snapshot: ${sourcePath}: ${error?.message || error}`)
        })
      }
    }
  }

  private shouldSkipProfileEntry(name: string): boolean {
    return [
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'DevToolsActivePort',
      'CrashpadMetrics-active.pma'
    ].includes(name)
  }

  private async pruneDirectory(directory: string, keep: number): Promise<void> {
    const children = await this.sortedChildren(directory)
    const stale = children.slice(0, Math.max(0, children.length - keep))
    for (const child of stale) {
      await fs.rm(path.join(directory, child), { recursive: true, force: true }).catch(() => null)
    }
  }

  private async sortedChildren(directory: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      const withStats = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name)
        const stat = await fs.stat(fullPath).catch(() => null)
        return { name: entry.name, mtimeMs: stat?.mtimeMs || 0 }
      }))
      return withStats.sort((a, b) => a.mtimeMs - b.mtimeMs).map((entry) => entry.name)
    } catch (_) {
      return []
    }
  }

  private async isUsableDirectory(directory: string): Promise<boolean> {
    try {
      const stat = await fs.stat(directory)
      if (!stat.isDirectory()) return false
      const entries = await fs.readdir(directory)
      return entries.length > 0
    } catch (_) {
      return false
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch (_) {
      return false
    }
  }

  private timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-')
  }

  private safeReason(reason: string): string {
    return (reason || 'snapshot')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'snapshot'
  }
}
