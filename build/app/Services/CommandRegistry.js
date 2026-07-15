"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const Application_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Application"));
const SessionManager_1 = __importDefault(global[Symbol.for('ioc.use')]("App/Services/SessionManager"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const ts = __importStar(require("typescript"));
class CommandRegistry {
    static get isProduction() {
        return Env_1.default.get('NODE_ENV') === 'production';
    }
    static get projectRoot() {
        const appRoot = Application_1.default.appRoot;
        return path_1.default.basename(appRoot) === 'build' ? path_1.default.join(appRoot, '..') : appRoot;
    }
    static get sourceCommandsDir() {
        return path_1.default.join(this.projectRoot, 'app', 'Whatsapp', 'Commands');
    }
    static get executableCommandsDir() {
        return path_1.default.join(Application_1.default.appRoot, 'app', 'Whatsapp', 'Commands');
    }
    static toLogicalName(commandFile) {
        return commandFile.endsWith('.js') ? commandFile.replace(/\.js$/, '.ts') : commandFile;
    }
    static instantiateHandler(handlerClass, client) {
        if (typeof handlerClass === 'function' && handlerClass.prototype)
            return new handlerClass(client);
        return handlerClass;
    }
    static automationKey(clientId, logicalName) {
        return `${clientId}:${logicalName}`;
    }
    static async loadCommands() {
        this.handlers.clear();
        const execDir = this.executableCommandsDir;
        if (!(0, fs_1.existsSync)(execDir)) {
            await fs_1.promises.mkdir(execDir, { recursive: true });
        }
        const isProd = this.isProduction;
        const files = await fs_1.promises.readdir(execDir);
        for (const file of files) {
            if (isProd) {
                if (!file.endsWith('.js'))
                    continue;
            }
            else {
                if (!file.endsWith('.ts') && !file.endsWith('.js'))
                    continue;
                if (file.endsWith('.d.ts'))
                    continue;
            }
            const fullPath = path_1.default.join(execDir, file);
            try {
                const resolvedPath = require.resolve(fullPath);
                if (require.cache[resolvedPath]) {
                    delete require.cache[resolvedPath];
                }
            }
            catch (e) { }
            try {
                const imported = require(fullPath);
                const handler = imported.default || imported;
                if (handler) {
                    const logicalName = file.replace(/\.js$/, '.ts');
                    this.handlers.set(logicalName, handler);
                }
            }
            catch (err) {
                console.error(`Failed to load module ${file}:`, err);
            }
        }
        console.log(`Loaded ${this.handlers.size} WhatsApp logic modules from repository.`);
    }
    static getAvailableFiles() {
        return Array.from(this.handlers.keys());
    }
    static getAvailableModules() {
        const files = Array.from(this.handlers.keys());
        return files.map(file => {
            const handlerClass = this.handlers.get(file);
            let instructions = 'No description provided.';
            let type = 'Module';
            try {
                const instance = this.instantiateHandler(handlerClass);
                if (handlerClass.instructions)
                    instructions = handlerClass.instructions;
                else if (instance && instance.instructions)
                    instructions = instance.instructions;
                if (handlerClass.type)
                    type = handlerClass.type;
                else if (instance && instance.type)
                    type = instance.type;
            }
            catch (e) { }
            return { filename: file, instructions, type };
        });
    }
    static async getFileContent(filename) {
        const safePath = path_1.default.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
        const logicalName = this.toLogicalName(safePath);
        const fullPath = path_1.default.join(this.sourceCommandsDir, logicalName);
        if (!(0, fs_1.existsSync)(fullPath))
            throw new Error('File not found');
        return await fs_1.promises.readFile(fullPath, 'utf-8');
    }
    static async saveFileContent(filename, content) {
        const safePath = path_1.default.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
        const logicalName = this.toLogicalName(safePath);
        const sourcePath = path_1.default.join(this.sourceCommandsDir, logicalName);
        if (!(0, fs_1.existsSync)(this.sourceCommandsDir)) {
            await fs_1.promises.mkdir(this.sourceCommandsDir, { recursive: true });
        }
        await fs_1.promises.writeFile(sourcePath, content, 'utf-8');
        if (this.isProduction) {
            const jsFilename = logicalName.replace(/\.ts$/, '.js');
            const execPath = path_1.default.join(this.executableCommandsDir, jsFilename);
            if (!(0, fs_1.existsSync)(this.executableCommandsDir)) {
                await fs_1.promises.mkdir(this.executableCommandsDir, { recursive: true });
            }
            const jsContent = ts.transpileModule(content, {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES2022,
                    esModuleInterop: true
                }
            }).outputText;
            await fs_1.promises.writeFile(execPath, jsContent, 'utf-8');
        }
        await this.loadCommands();
    }
    static async reconcileAutomations(clientId, client, commandFiles = []) {
        const desiredKeys = new Set();
        for (const commandFile of commandFiles || []) {
            const logicalName = this.toLogicalName(commandFile);
            const handlerClass = this.handlers.get(logicalName);
            if (!handlerClass)
                continue;
            let instance;
            try {
                instance = this.instantiateHandler(handlerClass, client);
            }
            catch (err) {
                console.error(`Error initializing automation ${logicalName}:`, err);
                continue;
            }
            if (!instance || typeof instance.start !== 'function')
                continue;
            const key = this.automationKey(clientId, logicalName);
            desiredKeys.add(key);
            if (this.automationInstances.has(key))
                continue;
            try {
                await instance.start(client, clientId);
                this.automationInstances.set(key, instance);
            }
            catch (err) {
                console.error(`Error starting automation ${logicalName}:`, err);
            }
        }
        for (const [key, instance] of Array.from(this.automationInstances.entries())) {
            if (!key.startsWith(`${clientId}:`) || desiredKeys.has(key))
                continue;
            try {
                if (typeof instance.stop === 'function')
                    await instance.stop();
            }
            catch (err) {
                console.error(`Error stopping automation ${key}:`, err);
            }
            finally {
                this.automationInstances.delete(key);
            }
        }
    }
    static async stopAutomations(clientId) {
        for (const [key, instance] of Array.from(this.automationInstances.entries())) {
            if (!key.startsWith(`${clientId}:`))
                continue;
            try {
                if (typeof instance.stop === 'function')
                    await instance.stop();
            }
            catch (err) {
                console.error(`Error stopping automation ${key}:`, err);
            }
            finally {
                this.automationInstances.delete(key);
            }
        }
    }
    static async execute(commandFiles, message, client, rules = {}) {
        if (message.isStatus || message.from === 'status@broadcast' || message.to === 'status@broadcast') {
            return;
        }
        const session = SessionManager_1.default.getOrCreate(message.from);
        const isGroup = message.from.endsWith('@g.us');
        if (!commandFiles || commandFiles.length === 0)
            return;
        for (const commandFile of commandFiles) {
            const logicalName = this.toLogicalName(commandFile);
            const handlerClass = this.handlers.get(logicalName);
            if (handlerClass) {
                const rule = rules[logicalName] || rules[commandFile] || { include: [], exclude: [] };
                if (rule.exclude && rule.exclude.includes(message.from)) {
                    continue;
                }
                if (isGroup && (!rule.include || !rule.include.includes(message.from))) {
                    continue;
                }
                try {
                    if (typeof handlerClass.handle === 'function') {
                        await handlerClass.handle(message, client, session);
                    }
                    else if (handlerClass.prototype && typeof handlerClass.prototype.handle === 'function') {
                        const instance = new handlerClass(client);
                        await instance.handle(message, client, session);
                    }
                    else if (handlerClass.prototype && typeof handlerClass.prototype.response === 'function') {
                        const instance = new handlerClass(client);
                        await instance.response(message);
                    }
                    else if (typeof handlerClass === 'function') {
                        await handlerClass(message, client, session);
                    }
                }
                catch (err) {
                    console.error(`Error executing handler ${logicalName}:`, err);
                }
            }
        }
    }
}
exports.default = CommandRegistry;
CommandRegistry.handlers = new Map();
CommandRegistry.automationInstances = new Map();
//# sourceMappingURL=CommandRegistry.js.map