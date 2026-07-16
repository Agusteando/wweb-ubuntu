import Env from '@ioc:Adonis/Core/Env'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export type GuardedDispatchResult = {
  statusCode: number
  body: any
}

type StoredResult = {
  key: string
  state: 'processing' | 'completed'
  createdAt: number
  expiresAt: number
  result?: GuardedDispatchResult
}

type GuardExecution = {
  result: GuardedDispatchResult
  replayed: boolean
  expiresAt: number
  keyType: 'explicit' | 'automatic'
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value

  const output: Record<string, any> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = stableValue(value[key])
  }
  return output
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

class ApiSendGuard {
  private entries = new Map<string, StoredResult>()
  private inFlight = new Map<string, Promise<GuardExecution>>()
  private loaded = false
  private loading: Promise<void> | null = null
  private writing: Promise<void> = Promise.resolve()

  private get storagePath(): string {
    return path.join(Env.get('WA_SESSION_DIR'), 'api-send-idempotency.json')
  }

  public createKey(scope: string, payload: any, explicitKey?: string): {
    key: string
    keyType: 'explicit' | 'automatic'
  } {
    if (explicitKey && explicitKey.trim()) {
      return {
        key: `explicit:${sha256(`${scope}:${explicitKey.trim()}`)}`,
        keyType: 'explicit',
      }
    }

    const serialized = JSON.stringify(stableValue({ scope, payload }))
    return {
      key: `automatic:${sha256(serialized)}`,
      keyType: 'automatic',
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loading) return this.loading

    this.loading = (async () => {
      try {
        const raw = await fs.promises.readFile(this.storagePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.entries)) {
          const now = Date.now()
          for (const item of parsed.entries) {
            const validState = item?.state === 'processing' || item?.state === 'completed'
            const validCompletedResult = item?.state !== 'completed' || (
              item.result && typeof item.result.statusCode === 'number'
            )
            if (
              item &&
              typeof item.key === 'string' &&
              validState &&
              validCompletedResult &&
              typeof item.expiresAt === 'number' &&
              item.expiresAt > now
            ) {
              this.entries.set(item.key, item)
            }
          }
        }
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          console.error('[api-send-guard] Unable to read idempotency ledger:', error)
        }
      } finally {
        this.loaded = true
        this.loading = null
      }
    })()

    return this.loading
  }

  private cleanup(now = Date.now()): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }

  private async persist(): Promise<void> {
    const snapshot = Array.from(this.entries.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10000)

    this.entries = new Map(snapshot.map((entry) => [entry.key, entry]))

    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const destination = this.storagePath
        await fs.promises.mkdir(path.dirname(destination), { recursive: true })
        const temporary = `${destination}.${process.pid}.tmp`
        await fs.promises.writeFile(
          temporary,
          JSON.stringify({ version: 2, entries: snapshot }, null, 2),
          'utf8'
        )
        await fs.promises.rename(temporary, destination)
      })

    await this.writing
  }

  private processingReplay(expiresAt: number): GuardedDispatchResult {
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
    }
  }

  public async execute(
    key: string,
    keyType: 'explicit' | 'automatic',
    ttlMs: number,
    operation: () => Promise<GuardedDispatchResult>
  ): Promise<GuardExecution> {
    await this.ensureLoaded()
    const now = Date.now()
    this.cleanup(now)

    const stored = this.entries.get(key)
    if (stored) {
      if (stored.state === 'completed' && stored.result) {
        return {
          result: stored.result,
          replayed: true,
          expiresAt: stored.expiresAt,
          keyType,
        }
      }

      return {
        result: this.processingReplay(stored.expiresAt),
        replayed: true,
        expiresAt: stored.expiresAt,
        keyType,
      }
    }

    const running = this.inFlight.get(key)
    if (running) {
      const shared = await running
      return { ...shared, replayed: true }
    }

    const createdAt = Date.now()
    const expiresAt = createdAt + ttlMs
    this.entries.set(key, {
      key,
      state: 'processing',
      createdAt,
      expiresAt,
    })

    // Write-ahead protection: if the process stops after WhatsApp is called,
    // a repeated request after restart is still suppressed rather than resent.
    await this.persist()

    const task = (async (): Promise<GuardExecution> => {
      let result: GuardedDispatchResult
      try {
        result = await operation()
      } catch (error: any) {
        result = {
          statusCode: 500,
          body: {
            status: 'error',
            success: false,
            error: error?.message || String(error),
            retriesPerformed: 0,
          },
        }
      }

      this.entries.set(key, {
        key,
        state: 'completed',
        createdAt,
        expiresAt,
        result,
      })
      await this.persist()
      return { result, replayed: false, expiresAt, keyType }
    })()

    this.inFlight.set(key, task)
    try {
      return await task
    } finally {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key)
    }
  }
}

export default new ApiSendGuard()
