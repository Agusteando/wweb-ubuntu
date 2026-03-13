import { Client, Message } from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import SessionManager from './SessionManager'
import Automations from '../Whatsapp/Automations'

class CommandRegistry {
  public handlers: Map<string, any> = new Map()

  public async loadCommands() {
    this.handlers.clear()
    
    // Unifies bot definitions into ONE canonical logic directory
    const commandsDir = path.join(Application.appRoot, 'app', 'Whatsapp', 'Commands')
    
    try {
      await fs.mkdir(commandsDir, { recursive: true })
      const files = await fs.readdir(commandsDir)
      
      for (const file of files) {
        if ((file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')) {
          const commandPath = path.join(commandsDir, file)
          
          // Allow hot-reloading capability
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

  public async execute(commandFile: string | null, message: Message, client: Client) {
    const session = SessionManager.getOrCreate(message.from)
    
    // Always trigger global automations beforehand
    await Automations.run(message, client, session)

    if (!commandFile) return // The client doesn't have an automated handler attached

    const handlerClass = this.handlers.get(commandFile)
    if (handlerClass) {
      try {
        // Broad compatibility wrapper (supports static, class instances, or legacy logic signatures)
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
        await message.reply(`❌ Error executing bot module: ${err.message}`)
      }
    }
  }
}

export default new CommandRegistry()