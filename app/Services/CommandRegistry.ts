import { Client, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import SessionManager from 'App/Services/SessionManager'

export default class CommandRegistry {
  public static handlers: Map<string, any> = new Map()

  private static get commandsDir() {
    return path.join(Application.appRoot, 'app', 'Whatsapp', 'Commands')
  }

  public static async loadCommands() {
    this.handlers.clear()
    
    try {
      await fs.mkdir(this.commandsDir, { recursive: true })
      const files = await fs.readdir(this.commandsDir)
      
      for (const file of files) {
        if ((file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')) {
          const commandPath = path.join(this.commandsDir, file)
          
          try {
            // Un-cache the file explicitly to allow real-time code editor updates
            const resolvedPath = require.resolve(commandPath)
            if (require.cache[resolvedPath]) {
              delete require.cache[resolvedPath]
            }
          } catch(e) {} // ignore if not cached yet
          
          const imported = require(commandPath)
          const handler = imported.default || imported
          
          if (handler) {
            this.handlers.set(file, handler)
          }
        }
      }
      console.log(`Loaded ${this.handlers.size} WhatsApp logic modules.`)
    } catch (err) {
      console.error('Failed to load logic modules:', err)
    }
  }

  public static getAvailableFiles(): string[] {
    return Array.from(this.handlers.keys())
  }

  public static getAvailableModules(): any[] {
    const files = Array.from(this.handlers.keys())
    return files.map(file => {
      const handlerClass = this.handlers.get(file)
      let instructions = 'No description provided.'
      let type = 'Module'
      
      try {
        const instance = (typeof handlerClass === 'function' && handlerClass.prototype) 
          ? new handlerClass(null) 
          : handlerClass;

        if (handlerClass.instructions) instructions = handlerClass.instructions
        else if (instance && instance.instructions) instructions = instance.instructions

        if (handlerClass.type) type = handlerClass.type
        else if (instance && instance.type) type = instance.type
      } catch (e) {}

      return { filename: file, instructions, type }
    })
  }

  public static async getFileContent(filename: string): Promise<string> {
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(this.commandsDir, safePath)
    return await fs.readFile(fullPath, 'utf-8')
  }

  public static async saveFileContent(filename: string, content: string): Promise<void> {
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(this.commandsDir, safePath)
    await fs.writeFile(fullPath, content, 'utf-8')
    await this.loadCommands() // Hot reload!
  }

  public static async execute(commandFiles: string[], message: Message, client: Client) {
    const session = SessionManager.getOrCreate(message.from)
    
    if (!commandFiles || commandFiles.length === 0) return

    for (const commandFile of commandFiles) {
      const handlerClass = this.handlers.get(commandFile)
      if (handlerClass) {
        try {
          if (typeof handlerClass.handle === 'function') {
            await handlerClass.handle(message, client, session)
          } else if (handlerClass.prototype && typeof handlerClass.prototype.handle === 'function') {
            const instance = new handlerClass(client)
            await instance.handle(message, client, session)
          } else if (handlerClass.prototype && typeof handlerClass.prototype.response === 'function') {
            const instance = new handlerClass(client)
            await instance.response(message)
          } else if (typeof handlerClass === 'function') {
            await handlerClass(message, client, session)
          }
        } catch (err) {
          console.error(`Error executing handler ${commandFile}:`, err)
        }
      }
    }
  }
}