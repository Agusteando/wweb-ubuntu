import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'

class TaskQueue {
  private queue: Array<() => Promise<void>> = []
  private isProcessing = false

  public push(task: () => Promise<void>) {
    this.queue.push(task)
    this.process()
  }

  private async process() {
    if (this.isProcessing) return
    this.isProcessing = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (task) {
        try {
          await task()
        } catch (err) {
          console.error('Error processing queue task:', err)
        }
        const delay = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    this.isProcessing = false
  }
}

const messageQueue = new TaskQueue()

interface ClientData {
  clientId: string
  status: 'pending' | 'ready' | 'error'
  commandFile?: string
}

export default class BotService {
  public clients: Map<string, Client> = new Map()
  public qrCodes: Map<string, string | null> = new Map()
  public statuses: Map<string, 'pending' | 'ready' | 'error'> = new Map()
  public commands: Map<string, any> = new Map()

  private dataDir: string
  private clientsFile: string

  constructor() {
    // Safely resolve the data directory using cross-platform path.join
    this.dataDir = path.join(Application.appRoot, 'data')
    this.clientsFile = path.join(this.dataDir, 'clients.json')
    this.init()
  }

  private async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    this.loadClients()
      .then(() => console.log('Loaded existing clients from JSON'))
      .catch((err) => console.error('Error loading clients on startup:', err))
  }

  private async loadClients(): Promise<void> {
    try {
      const data = await fs.readFile(this.clientsFile, 'utf8')
      const clients: ClientData[] = JSON.parse(data)
      for (const client of clients) {
        this.addClient(client.clientId, client.status, client.commandFile, false)
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        await fs.writeFile(this.clientsFile, JSON.stringify([]))
      }
    }
  }

  private async saveClients(): Promise<void> {
    const clients: ClientData[] = Array.from(this.statuses.entries()).map(([clientId, status]) => ({
      clientId,
      status,
      commandFile: this.commands.get(clientId)?.fileName || undefined,
    }))
    try {
      await fs.writeFile(this.clientsFile, JSON.stringify(clients, null, 2))
    } catch (err) {
      console.error('Failed to save clients:', err)
    }
  }

  public async getCommandFiles(): Promise<string[]> {
    const COMMANDS_DIR = path.join(__dirname, 'Commands')
    try {
      const files = await fs.readdir(COMMANDS_DIR)
      return files.filter(
        (file) => (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
      )
    } catch (err) {
      return []
    }
  }

  public async setCommandFile(clientId: string, commandFile: string): Promise<void> {
    if (!this.clients.has(clientId)) {
      this.addClient(clientId)
    }
    
    if (commandFile) {
      const COMMANDS_DIR = path.join(__dirname, 'Commands')
      const commandPath = path.join(COMMANDS_DIR, commandFile)

      try {
        // Defensively delete cache on set/reset so commands properly hot-swap
        try {
          const resolvedPath = require.resolve(commandPath)
          if (require.cache[resolvedPath]) {
            delete require.cache[resolvedPath]
          }
        } catch (e) {
          // Ignore resolution errors if module wasn't previously loaded
        }

        const { default: CommandClass } = require(commandPath)
        const actions = new CommandClass(this.clients.get(clientId))
        actions.fileName = commandFile
        this.commands.set(clientId, actions)
      } catch (err) {
        console.error(`Error loading command file ${commandFile} for ${clientId}:`, err)
        throw err
      }
    } else {
      this.commands.delete(clientId)
    }
    await this.saveClients()
  }

  // Guaranteed valid Client return ensuring no undefined states upstream
  public getOrCreateClient(clientId: string): Client {
    if (!this.clients.has(clientId)) {
      this.addClient(clientId)
    }
    return this.clients.get(clientId)!
  }

  public addClient(
    clientId: string,
    initialStatus: 'pending' | 'ready' | 'error' = 'pending',
    commandFile?: string,
    save: boolean = true
  ): void {
    if (this.clients.has(clientId)) return

    const client = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: path.join(this.dataDir, '.wwebjs_auth') }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ],
      },
    })

    this.clients.set(clientId, client)
    this.qrCodes.set(clientId, null)
    this.statuses.set(clientId, initialStatus)

    if (commandFile) {
      this.setCommandFile(clientId, commandFile).catch(console.error)
    }

    client.on('qr', (qr: string) => {
      this.qrCodes.set(clientId, qr)
      this.statuses.set(clientId, 'pending')
      this.saveClients()
    })

    client.on('ready', () => {
      this.qrCodes.set(clientId, null)
      this.statuses.set(clientId, 'ready')
      this.saveClients()
    })

    client.on('auth_failure', () => {
      this.statuses.set(clientId, 'error')
      this.saveClients()
    })

    client.on('disconnected', () => {
      this.statuses.set(clientId, 'pending')
      this.saveClients()
      client.initialize().catch(console.error)
    })

    client.on('message', async (message: Message) => {
      if (message.fromMe) return
      const actions = this.commands.get(clientId)
      if (actions && typeof actions.response === 'function') {
        messageQueue.push(async () => {
          await actions.response(message, client)
        })
      }
    })

    client.on('message_create', async (message: Message) => {
      if (!message.fromMe) return
      const actions = this.commands.get(clientId)
      if (actions && typeof actions.response === 'function') {
        messageQueue.push(async () => {
          await actions.response(message, client)
        })
      }
    })

    client.initialize().catch((err) => {
      console.error(`Error initializing client ${clientId}:`, err)
      this.statuses.set(clientId, 'error')
      this.saveClients()
    })

    if (save) this.saveClients()
  }

  public async removeClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId)
    if (!client) return

    try {
      await client.destroy()
    } catch (err) {
      console.error(`Error destroying client ${clientId}:`, err)
    }

    this.clients.delete(clientId)
    this.qrCodes.delete(clientId)
    this.statuses.delete(clientId)
    this.commands.delete(clientId)
    await this.saveClients()
  }

  public async sendMessage(clientId: string, chatId: string, message: string): Promise<Message> {
    // Rely on getOrCreate to ensure standard validation before message dispatch
    const client = this.getOrCreateClient(clientId)
    if (this.statuses.get(clientId) !== 'ready') throw new Error(`Client ${clientId} is not ready`)

    const chat = await client.getChatById(chatId)
    return await chat.sendMessage(message)
  }
}