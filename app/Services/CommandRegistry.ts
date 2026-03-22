// filepath: app/Services/CommandRegistry.ts
import { Client, Message } from 'whatsapp-web.js'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import SessionManager from 'App/Services/SessionManager'
import Env from '@ioc:Adonis/Core/Env'
import * as ts from 'typescript'

export default class CommandRegistry {
  public static handlers: Map<string, any> = new Map()

  private static get isProduction() {
    return Env.get('NODE_ENV') === 'production'
  }

  private static get projectRoot() {
    const appRoot = Application.appRoot
    // Resolve project root depending on whether the app is executing from the build directory
    return path.basename(appRoot) === 'build' ? path.join(appRoot, '..') : appRoot
  }

  private static get sourceCommandsDir() {
    return path.join(this.projectRoot, 'app', 'Whatsapp', 'Commands')
  }

  private static get executableCommandsDir() {
    // In production, Application.appRoot points to the build directory.
    // In dev, it points to the repo root.
    return path.join(Application.appRoot, 'app', 'Whatsapp', 'Commands')
  }

  public static async loadCommands() {
    this.handlers.clear()
    
    const execDir = this.executableCommandsDir
    if (!existsSync(execDir)) {
      await fs.mkdir(execDir, { recursive: true })
    }

    const isProd = this.isProduction
    const files = await fs.readdir(execDir)
    
    for (const file of files) {
      if (isProd) {
        if (!file.endsWith('.js')) continue
      } else {
        if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
        if (file.endsWith('.d.ts')) continue
      }

      const fullPath = path.join(execDir, file)
      
      try {
        const resolvedPath = require.resolve(fullPath)
        if (require.cache[resolvedPath]) {
          delete require.cache[resolvedPath]
        }
      } catch(e: any) {} 
      
      try {
        const imported = require(fullPath)
        const handler = imported.default || imported
        if (handler) {
          // Expose stable logical .ts filenames for the registry and UI
          const logicalName = file.replace(/\.js$/, '.ts')
          this.handlers.set(logicalName, handler) 
        }
      } catch(err) {
        // Prevent boot crash if a single script has syntax errors
        console.error(`Failed to load module ${file}:`, err)
      }
    }
    console.log(`Loaded ${this.handlers.size} WhatsApp logic modules from repository.`)
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
    const logicalName = safePath.endsWith('.js') ? safePath.replace(/\.js$/, '.ts') : safePath
    const fullPath = path.join(this.sourceCommandsDir, logicalName)
    if (!existsSync(fullPath)) throw new Error('File not found')
    return await fs.readFile(fullPath, 'utf-8')
  }

  public static async saveFileContent(filename: string, content: string): Promise<void> {
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const logicalName = safePath.endsWith('.js') ? safePath.replace(/\.js$/, '.ts') : safePath
    const sourcePath = path.join(this.sourceCommandsDir, logicalName)

    if (!existsSync(this.sourceCommandsDir)) {
      await fs.mkdir(this.sourceCommandsDir, { recursive: true })
    }

    // Always persist code into the source repository
    await fs.writeFile(sourcePath, content, 'utf-8')

    // Hot-reload workflow for production: Transpile TS directly into the JS executable path
    if (this.isProduction) {
      const jsFilename = logicalName.replace(/\.ts$/, '.js')
      const execPath = path.join(this.executableCommandsDir, jsFilename)
      
      if (!existsSync(this.executableCommandsDir)) {
        await fs.mkdir(this.executableCommandsDir, { recursive: true })
      }

      const jsContent = ts.transpileModule(content, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText
      
      await fs.writeFile(execPath, jsContent, 'utf-8')
    }

    // Re-evaluate handlers into memory to apply changes live
    await this.loadCommands()
  }

  public static async execute(commandFiles: string[], message: Message, client: Client, rules: Record<string, { include: string[], exclude: string[] }> = {}) {
    // SECURITY PATCH: Prevent automated systems from interpreting, transcribing, or replying to Statuses (Stories)
    if (message.isStatus || message.from === 'status@broadcast' || message.to === 'status@broadcast') {
      return;
    }

    const session = SessionManager.getOrCreate(message.from)
    const isGroup = message.from.endsWith('@g.us')
    
    if (!commandFiles || commandFiles.length === 0) return

    for (const commandFile of commandFiles) {
      const logicalName = commandFile.endsWith('.js') ? commandFile.replace(/\.js$/, '.ts') : commandFile;
      const handlerClass = this.handlers.get(logicalName)
      
      if (handlerClass) {
        
        const rule = rules[logicalName] || rules[commandFile] || { include: [], exclude: [] }
        
        if (rule.exclude && rule.exclude.includes(message.from)) {
          continue;
        }

        if (isGroup && (!rule.include || !rule.include.includes(message.from))) {
          continue;
        }

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
          console.error(`Error executing handler ${logicalName}:`, err)
        }
      }
    }
  }
}