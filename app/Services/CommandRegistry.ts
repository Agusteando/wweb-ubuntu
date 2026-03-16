import { Client, Message } from 'whatsapp-web.js'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import Application from '@ioc:Adonis/Core/Application'
import SessionManager from 'App/Services/SessionManager'
import Env from '@ioc:Adonis/Core/Env'
import * as ts from 'typescript'

export default class CommandRegistry {
  public static handlers: Map<string, any> = new Map()

  private static get customScriptsDir() {
    const baseDir = Env.get('WA_SESSION_DIR')
    if (!baseDir) {
      throw new Error('CRITICAL: WA_SESSION_DIR environment variable is missing.')
    }
    return path.join(baseDir, 'scripts')
  }

  private static get coreScriptsDir() {
    return path.join(Application.appRoot, 'app', 'Whatsapp', 'Commands')
  }

  public static async loadCommands() {
    this.handlers.clear()
    
    const coreDir = this.coreScriptsDir
    const customDir = this.customScriptsDir
    
    await fs.mkdir(customDir, { recursive: true })

    // 1. Load Core Scripts (Git Source of Truth)
    if (existsSync(coreDir)) {
      const coreFiles = await fs.readdir(coreDir)
      for (const file of coreFiles) {
        if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
          await this.compileAndLoad(coreDir, file, true)
        }
      }
    }

    // 2. Load Custom Scripts / Overrides (External UI Edits)
    const customFiles = await fs.readdir(customDir)
    for (const file of customFiles) {
      if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        await this.compileAndLoad(customDir, file, false)
      }
    }

    console.log(`Loaded ${this.handlers.size} WhatsApp logic modules.`)
  }

  private static async compileAndLoad(dir: string, file: string, isCore: boolean) {
    const tsPath = path.join(dir, file)
    const jsFilename = file.replace(/\.ts$/, '.js')
    
    // Core files can be compiled locally in temp or executed directly if building, 
    // but transpile dynamically to ensure consistency
    const tempOutputDir = path.join(this.customScriptsDir, '.cache')
    if (!existsSync(tempOutputDir)) await fs.mkdir(tempOutputDir, { recursive: true })
    
    const jsPath = path.join(tempOutputDir, jsFilename)
    
    try {
      const tsContent = await fs.readFile(tsPath, 'utf-8')
      const jsContent = ts.transpileModule(tsContent, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText
      
      await fs.writeFile(jsPath, jsContent, 'utf-8')
      
      try {
        const resolvedPath = require.resolve(jsPath)
        if (require.cache[resolvedPath]) {
          delete require.cache[resolvedPath]
        }
      } catch(e: any) {} 
      
      const imported = require(jsPath)
      const handler = imported.default || imported
      if (handler) {
        this.handlers.set(file, handler) 
      }
    } catch (err) {
      console.error(`Failed to load ${isCore ? 'core' : 'custom'} module ${file}:`, err)
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
    
    // Check custom overrides first
    const customPath = path.join(this.customScriptsDir, safePath)
    if (existsSync(customPath)) return await fs.readFile(customPath, 'utf-8')
    
    // Fallback to core source of truth
    const corePath = path.join(this.coreScriptsDir, safePath)
    if (existsSync(corePath)) return await fs.readFile(corePath, 'utf-8')

    throw new Error('File not found in core or custom directories')
  }

  public static async saveFileContent(filename: string, content: string): Promise<void> {
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(this.customScriptsDir, safePath)
    
    // Always save edits to the custom directory so Git tracking isn't disrupted
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
          console.error(`Error executing handler ${commandFile}:`, err)
        }
      }
    }
  }
}