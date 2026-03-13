import { Client, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import SessionManager from './SessionManager'
import Automations from '../Whatsapp/Automations'

class CommandRegistry {
  public handlers: Map<string, any> = new Map()

  private get commandsDir() {
    return path.join(Application.appRoot, 'app', 'Whatsapp', 'Commands')
  }

  public async loadCommands() {
    this.handlers.clear()
    
    try {
      await fs.mkdir(this.commandsDir, { recursive: true })
      const files = await fs.readdir(this.commandsDir)
      
      for (const file of files) {
        if ((file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')) {
          const commandPath = path.join(this.commandsDir, file)
          delete require.cache[require.resolve(commandPath)]
          
          const imported = require(commandPath)
          const handler = imported.default || imported
          
          if (handler) {
            this.handlers.set(file, handler)
          }
        }
      }
      console.log(`Loaded ${this.handlers.size} WhatsApp command modules.`)
    } catch (err) {
      console.error('Failed to load command modules:', err)
    }
  }

  public getAvailableFiles(): string[] {
    return Array.from(this.handlers.keys())
  }

  public async getFileContent(filename: string): Promise<string> {
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(this.commandsDir, safePath)
    return await fs.readFile(fullPath, 'utf-8')
  }

  public async saveFileContent(filename: string, content: string): Promise<void> {
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(this.commandsDir, safePath)
    await fs.writeFile(fullPath, content, 'utf-8')
    await this.loadCommands() // Hot reload!
  }

  public async execute(commandFiles: string[], message: Message, client: Client) {
    const session = SessionManager.getOrCreate(message.from)
    
    // Always trigger global automations beforehand
    await Automations.run(message, client, session)

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

export default new CommandRegistry()