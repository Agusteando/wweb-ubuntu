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
            const resolvedPath = require.resolve(commandPath)
            if (require.cache[resolvedPath]) {
              delete require.cache[resolvedPath]
            }
          } catch(e: any) {} 
          
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
      } catch (e: any) {}

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
    await this.loadCommands()
  }

  public static async execute(commandFiles: string[], message: Message, client: Client, rules: Record<string, { include: string[], exclude: string[] }> = {}) {
    const session = SessionManager.getOrCreate(message.from)
    const isGroup = message.from.endsWith('@g.us')
    
    if (!commandFiles || commandFiles.length === 0) return

    for (const commandFile of commandFiles) {
      const handlerClass = this.handlers.get(commandFile)
      if (handlerClass) {
        
        const rule = rules[commandFile] || { include: [], exclude: [] }
        
        // Exclusions: if the chat is explicitly excluded, skip it.
        if (rule.exclude && rule.exclude.includes(message.from)) {
          continue;
        }

        // Group inclusion rule: if it's a group, block by default UNLESS explicitly included.
        if (isGroup && (!rule.include || !rule.include.includes(message.from))) {
          continue;
        }

        // Direct message check: allowed by default unless excluded (checked above), but we check if include is enforced globally.
        // We only enforce strict include for groups as requested ("by default automations won't be triggered on groups unless enabled").

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