"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Application_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Application"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const CommandRegistry_1 = __importDefault(global[Symbol.for('ioc.use')]("App/Services/CommandRegistry"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const whatsapp_web_js_1 = require("whatsapp-web.js");
const SentMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/SentMessage");
const ChatId_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/ChatId");
class BotController {
    get botService() {
        return Application_1.default.container.use('App/Services/BotService');
    }
    get scheduleService() {
        return Application_1.default.container.use('App/Services/ScheduleService');
    }
    getIntegrationBaseUrl(request) {
        const configured = Env_1.default.get('INTEGRATION_PUBLIC_BASE_URL');
        if (configured)
            return configured.replace(/\/+$/, '');
        const forwardedProto = request.header('x-forwarded-proto');
        const protocol = forwardedProto || (request.protocol ? request.protocol() : 'http');
        const forwardedHost = request.header('x-forwarded-host');
        const host = forwardedHost || request.header('host') || `localhost:${Env_1.default.get('PORT')}`;
        return `${protocol}://${host}`.replace(/\/+$/, '');
    }
    jsonError(response, statusCode, code, message, details) {
        return response.status(statusCode).json({
            status: 'error',
            success: false,
            error: {
                code,
                message,
                details
            }
        });
    }
    validateClientId(clientId) {
        if (!/^[A-Za-z0-9_-]{3,64}$/.test(clientId)) {
            throw new Error('clientId must be 3-64 characters and may only contain letters, numbers, underscores, or dashes');
        }
    }
    validateCommandFiles(commandFiles) {
        if (!commandFiles)
            return;
        if (!Array.isArray(commandFiles))
            throw new Error('commandFiles must be an array');
        const available = new Set(CommandRegistry_1.default.getAvailableFiles());
        const invalid = commandFiles.filter((file) => !available.has(file));
        if (invalid.length) {
            throw new Error(`Unknown command file(s): ${invalid.join(', ')}`);
        }
    }
    parseBoolean(value, defaultValue) {
        if (value === undefined || value === null || value === '')
            return defaultValue;
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(normalized))
                return true;
            if (['false', '0', 'no', 'off'].includes(normalized))
                return false;
        }
        return Boolean(value);
    }
    async index({ view, request }) {
        const integrationBaseUrl = this.getIntegrationBaseUrl(request);
        const clientsData = Array.from(this.botService.statuses.entries()).map(([clientId, status]) => {
            const config = this.botService.configs.get(clientId);
            const integrationDetails = this.botService.getIntegrationDetails(clientId, integrationBaseUrl, true);
            return {
                clientId,
                status: integrationDetails?.statusLabel || (this.botService.qrCodes.get(clientId) ? 'QR Received' : (status === 'ready' ? 'Connected' : (status === 'error' ? 'Error' : 'Awaiting QR'))),
                commandFiles: config?.commandFiles || [],
                commandRules: config?.commandRules || {},
                integration: integrationDetails,
                recentActivity: this.botService.getRecentLogs(clientId, 5)
            };
        });
        const commandFiles = CommandRegistry_1.default.getAvailableFiles();
        const modulesMetadata = CommandRegistry_1.default.getAvailableModules();
        return view.render('bot', {
            clients: clientsData,
            commandFiles,
            commandFilesJson: JSON.stringify(commandFiles),
            modulesMetadataJson: JSON.stringify(modulesMetadata),
            integrationBaseUrl,
            apiStatus: this.botService.apiStatus
        });
    }
    async downloadTemplate({ response }) {
        const template = [
            {
                "type": "message",
                "chatIds": ["1234567890@c.us"],
                "message": "Hello world!",
                "mediaPath": "https://example.com/image.png",
                "isRecurring": false,
                "timestamp": 1720000000000
            },
            {
                "type": "postTextStatus",
                "statusText": "This is a custom text status update",
                "backgroundColor": "#eb0c0c",
                "fontStyle": 1,
                "isRecurring": false,
                "timestamp": 1720005000000
            },
            {
                "type": "postMediaStatus",
                "mediaPath": "https://example.com/status_image.png",
                "caption": "Status image with a caption",
                "isGif": false,
                "isAudio": false,
                "isRecurring": false,
                "timestamp": 1720010000000
            },
            {
                "type": "revokeStatus",
                "revokeMessageId": "true_status@broadcast_3EB0XXXXX",
                "isRecurring": false,
                "timestamp": 1720015000000
            }
        ];
        response.header('Content-Type', 'application/json');
        response.header('Content-Disposition', 'attachment; filename="status_import_template.json"');
        return response.send(JSON.stringify(template, null, 2));
    }
    async getSchedules({ params, response }) {
        try {
            const schedules = this.scheduleService.getSchedulesForClient(params.clientId);
            const client = this.botService.clients.get(params.clientId);
            if (client && this.botService.statuses.get(params.clientId) === 'ready') {
                let changed = false;
                await Promise.all(schedules.map(async (s) => {
                    if (s.statusMessageId) {
                        try {
                            const msg = await client.getMessageById(s.statusMessageId);
                            if (msg) {
                                let viewerCount = 0;
                                if (Array.isArray(msg.viewerReceipts)) {
                                    viewerCount = msg.viewerReceipts.length;
                                }
                                else if (typeof msg.views === 'number') {
                                    viewerCount = msg.views;
                                }
                                if (typeof msg.getBroadcast === 'function') {
                                    try {
                                        const bcast = await msg.getBroadcast();
                                        if (bcast && Array.isArray(bcast.viewerReceipts)) {
                                            viewerCount = Math.max(viewerCount, bcast.viewerReceipts.length);
                                        }
                                        else if (bcast && typeof bcast.views === 'number') {
                                            viewerCount = Math.max(viewerCount, bcast.views);
                                        }
                                    }
                                    catch (e) { }
                                }
                                if (viewerCount > (s.viewsCount || 0)) {
                                    s.viewsCount = viewerCount;
                                    changed = true;
                                }
                            }
                        }
                        catch (err) {
                        }
                    }
                }));
                if (changed) {
                    await this.scheduleService.save();
                }
            }
            return response.json({ success: true, schedules });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async createSchedule({ params, request, response }) {
        try {
            const data = request.all();
            const file = request.file('file');
            if (data.type === 'postTextStatus' && (!data.statusText || data.statusText.trim() === '')) {
                throw new Error('A valid text body is required for Text Statuses.');
            }
            if (data.type === 'postMediaStatus' && (!file && !data.mediaPath)) {
                throw new Error('A valid file upload or URL is required for Media Statuses.');
            }
            if (file) {
                const sessionDir = Env_1.default.get('WA_SESSION_DIR');
                if (!sessionDir)
                    throw new Error('WA_SESSION_DIR missing');
                const persistentDir = path_1.default.join(sessionDir, 'scheduled_media');
                if (!fs_1.default.existsSync(persistentDir)) {
                    fs_1.default.mkdirSync(persistentDir, { recursive: true });
                }
                const safeName = `${Date.now()}_${file.clientName}`;
                await file.move(persistentDir, { name: safeName, overwrite: true });
                data.mediaPath = path_1.default.join(persistentDir, safeName);
            }
            if (data.chatIds)
                data.chatIds = Array.isArray(data.chatIds) ? data.chatIds : [data.chatIds];
            data.isRecurring = data.isRecurring === 'true' || data.isRecurring === true;
            if (data.isGif)
                data.isGif = data.isGif === 'true';
            if (data.isAudio)
                data.isAudio = data.isAudio === 'true';
            if (data.timestamp)
                data.timestamp = Number(data.timestamp);
            if (data.fontStyle)
                data.fontStyle = parseInt(data.fontStyle, 10);
            if (data.isRecurring) {
                data.recurrence = { type: data.recurrenceType, time: data.recurrenceTime };
                if (data.recurrenceType === 'weekly' && data.recurrenceDaysOfWeek) {
                    data.recurrence.daysOfWeek = data.recurrenceDaysOfWeek.split(',').map(Number);
                }
                if (data.recurrenceType === 'monthly' && data.recurrenceDayOfMonth) {
                    data.recurrence.dayOfMonth = Number(data.recurrenceDayOfMonth);
                }
            }
            const schedule = await this.scheduleService.createSchedule(params.clientId, data);
            return response.json({ success: true, schedule });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async updateSchedule({ params, request, response }) {
        try {
            const data = request.all();
            const schedule = await this.scheduleService.updateSchedule(params.clientId, params.id, data);
            return response.json({ success: true, schedule });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async deleteSchedule({ params, response }) {
        try {
            await this.scheduleService.deleteSchedule(params.clientId, params.id);
            return response.json({ success: true });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async deleteAllSchedules({ params, response }) {
        try {
            await this.scheduleService.deleteAllSchedules(params.clientId);
            return response.json({ success: true });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async bulkImportSchedules({ params, request, response }) {
        try {
            const { items } = request.all();
            const result = await this.scheduleService.bulkCreate(params.clientId, items);
            return response.json({ success: true, count: result.length });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async getApiLogs({ response }) {
        return response.json({ success: true, logs: this.botService.apiLogs });
    }
    async clearApiLogs({ response }) {
        this.botService.apiLogs = [];
        return response.json({ success: true });
    }
    async deleteApiLog({ params, response }) {
        this.botService.apiLogs = this.botService.apiLogs.filter(l => l.id !== params.id);
        return response.json({ success: true });
    }
    async toggleApiStatus({ request, response }) {
        const { status } = request.all();
        this.botService.apiStatus = status === true || status === 'true';
        await this.botService.saveRegistry();
        return response.json({ success: true, apiStatus: this.botService.apiStatus });
    }
    async add({ request, response }) {
        let clientId = request.input('clientId') || Math.random().toString(36).substring(7);
        this.botService.addClient(clientId);
        return response.redirect().toPath('/');
    }
    async remove({ request, response }) {
        await this.botService.removeClient(request.input('clientId'));
        return response.redirect().toPath('/');
    }
    async setCommands({ request, response }) {
        const clientId = request.input('clientId');
        const commandFiles = request.input('commandFiles', []);
        await this.botService.setCommands(clientId, Array.isArray(commandFiles) ? commandFiles : [commandFiles]);
        return response.json({ success: true });
    }
    async getChats({ params, response }) {
        try {
            const chats = await this.botService.getChats(params.clientId);
            return response.json({ success: true, chats });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async saveRules({ request, response, params }) {
        try {
            const { commandFile, include, exclude } = request.all();
            await this.botService.setCommandRules(params.clientId, commandFile, include, exclude);
            return response.json({ success: true });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async getEditorFiles({ response }) {
        return response.json({ files: CommandRegistry_1.default.getAvailableFiles() });
    }
    async getEditorFileContent({ params, response }) {
        try {
            const content = await CommandRegistry_1.default.getFileContent(params.name);
            return response.json({ success: true, content });
        }
        catch (e) {
            return response.status(404).json({ success: false, error: 'File not found' });
        }
    }
    async saveEditorFile({ request, response }) {
        try {
            const { filename, content } = request.all();
            await CommandRegistry_1.default.saveFileContent(filename, content);
            return response.json({ success: true });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async createEditorFile({ request, response }) {
        try {
            const { filename } = request.all();
            const safeName = filename.endsWith('.ts') ? filename : `${filename}.ts`;
            const template = `import { Client, Message } from 'whatsapp-web.js'\nimport { UserSession } from 'App/Services/SessionManager'\n\nexport default class NewModule {\n  public type = 'Module'\n  public instructions = 'Add description here'\n\n  async handle(message: Message, _client: Client, _session: UserSession) {\n    // Write your logic here\n  }\n}`;
            await CommandRegistry_1.default.saveFileContent(safeName, template);
            return response.json({ success: true, filename: safeName });
        }
        catch (e) {
            return response.status(500).json({ success: false, error: e.message });
        }
    }
    async dispatchMessages(request, requestedClientId) {
        let clientId = requestedClientId;
        let client;
        if (!this.botService.apiStatus) {
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: 'blocked',
                target: String(request.input('chatId') || 'unknown'),
                payloadSummary: `API Disabled. Blocked request.`,
                error: 'API message sending is globally disabled.'
            });
            return {
                statusCode: 403,
                body: { status: 'error', success: false, error: 'API message sending is currently disabled in the orchestrator.' }
            };
        }
        if (!clientId || clientId.toLowerCase() === 'any') {
            const readyClient = this.botService.getAnyReadyClient();
            if (!readyClient) {
                this.botService.logApi({
                    clientId: 'any',
                    endpoint: request.url(),
                    method: request.method(),
                    status: 'error',
                    target: String(request.input('chatId') || 'unknown'),
                    payloadSummary: `Message dispatch failed`,
                    error: 'No WhatsApp clients are currently connected or ready.'
                });
                return {
                    statusCode: 400,
                    body: { status: 'error', success: false, error: 'No WhatsApp clients are currently connected or ready to handle requests.' }
                };
            }
            client = readyClient.client;
            clientId = readyClient.id;
        }
        else {
            client = this.botService.clients.get(clientId);
            if (!client || this.botService.statuses.get(clientId) !== 'ready') {
                this.botService.logApi({
                    clientId,
                    endpoint: request.url(),
                    method: request.method(),
                    status: 'error',
                    target: String(request.input('chatId') || 'unknown'),
                    payloadSummary: `Message dispatch failed`,
                    error: `WhatsApp client '${clientId}' is not connected or ready.`
                });
                return {
                    statusCode: 400,
                    body: { status: 'error', success: false, error: `WhatsApp client '${clientId}' is not connected or ready.` }
                };
            }
        }
        let { chatId, message, caption, mentions, filepath, mimetype, options, filename, } = request.all();
        const args = {};
        let contacts = [];
        try {
            if (typeof chatId === 'string')
                chatId = [chatId];
            if (!chatId || !Array.isArray(chatId) || !chatId.length)
                throw new Error('chatId is undefined, not an array, or empty');
            chatId = Array.from(new Set(chatId.map((id) => typeof id === 'string' ? id.trim() : id)));
            for (const id of chatId) {
                if (typeof id !== 'string' || !id.includes('@'))
                    throw new Error(`Invalid chatId format: ${id}`);
            }
            if (filepath) {
                const media = await whatsapp_web_js_1.MessageMedia.fromFilePath(filepath);
                if (filename)
                    media.filename = filename;
                if (caption)
                    args.caption = caption;
                message = media;
            }
            else {
                const uploadedFile = request.file('file');
                if (uploadedFile) {
                    const sessionDir = Env_1.default.get('WA_SESSION_DIR');
                    if (!sessionDir)
                        throw new Error('WA_SESSION_DIR missing');
                    const customTempDir = path_1.default.join(sessionDir, 'uploads');
                    if (!fs_1.default.existsSync(customTempDir))
                        fs_1.default.mkdirSync(customTempDir, { recursive: true });
                    await uploadedFile.move(customTempDir, { name: uploadedFile.clientName, overwrite: true });
                    const tempFilePath = path_1.default.join(customTempDir, uploadedFile.clientName);
                    const media = await whatsapp_web_js_1.MessageMedia.fromFilePath(tempFilePath);
                    media.filename = uploadedFile.clientName;
                    args.mimetype = uploadedFile.headers['content-type'] || mimetype;
                    if (caption)
                        args.caption = caption;
                    message = media;
                    fs_1.default.unlinkSync(tempFilePath);
                }
            }
            if (!message) {
                message = caption || message;
            }
            else if (typeof message === 'string') {
                args.caption = message;
            }
            if (!message)
                throw new Error('message, caption, filepath, or file is required');
            if (mentions && Array.isArray(mentions)) {
                for (let i = 0; i < mentions.length; i++) {
                    const mentionStr = String(mentions[i]).trim();
                    contacts.push(mentionStr.includes('@') ? mentionStr : `${mentionStr}@c.us`);
                }
                args.mentions = contacts;
            }
            if (options && typeof options === 'object')
                Object.assign(args, options);
            const sentMessages = [];
            const failedMessages = [];
            for (let i = 0; i < chatId.length; i++) {
                const requestedChatId = chatId[i];
                try {
                    const currentChatId = await (0, ChatId_1.resolveCanonicalChatId)(client, requestedChatId);
                    const result = await client.sendMessage(currentChatId, message, args);
                    const metadata = (0, SentMessage_1.getSentMessageMetadata)(result, currentChatId);
                    sentMessages.push({
                        chatId: currentChatId,
                        requestedChatId: requestedChatId !== currentChatId ? requestedChatId : undefined,
                        id: metadata.id,
                        timestamp: metadata.timestamp,
                        state: metadata.state,
                    });
                }
                catch (sendMessageError) {
                    const errorMessage = sendMessageError?.message || String(sendMessageError);
                    failedMessages.push({ chatId: requestedChatId, error: errorMessage });
                    console.error(`Failed to send message to chat ${requestedChatId}:`, sendMessageError);
                }
            }
            const acceptedAny = sentMessages.length > 0;
            const success = acceptedAny && failedMessages.length === 0;
            const status = success ? 'ok' : acceptedAny ? 'partial' : 'error';
            const confirmedCount = sentMessages.length;
            let summaryText = '';
            if (typeof message === 'string')
                summaryText = message.substring(0, 100);
            else if (caption)
                summaryText = caption.substring(0, 100);
            else if (filename || mimetype)
                summaryText = `Media: ${filename || mimetype}`;
            else
                summaryText = 'Media Payload';
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: success ? 'success' : 'error',
                target: chatId.join(', '),
                payloadSummary: summaryText,
                error: success ? undefined : failedMessages.map((failure) => `${failure.chatId}: ${failure.error}`).join('; ')
            });
            return {
                statusCode: acceptedAny ? 200 : 502,
                body: {
                    status,
                    success,
                    clientUsed: clientId,
                    messages: sentMessages,
                    failures: failedMessages,
                    delivery: {
                        confirmed: confirmedCount,
                        submitted: 0,
                        retriesPerformed: 0,
                    },
                    error: success ? undefined : acceptedAny
                        ? 'The single send attempt was accepted for only some targets.'
                        : 'The single send attempt failed for every target. No retry or resend was performed.'
                }
            };
        }
        catch (error) {
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: 'error',
                target: String(chatId || request.input('chatId') || 'unknown'),
                payloadSummary: 'Failed request',
                error: error.message || 'An error occurred while sending messages'
            });
            return {
                statusCode: 500,
                body: { status: 'error', success: false, error: error.message || 'An error occurred while sending messages' }
            };
        }
    }
    async sendMessagesFromManager({ request, response, params }) {
        const result = await this.dispatchMessages(request, params.clientId);
        return response.status(result.statusCode).json(result.body);
    }
    async sendMessages({ request, response, params }) {
        response.header('X-Send-Retries', '0');
        const result = await this.dispatchMessages(request, params.clientId);
        return response.status(result.statusCode).json(result.body);
    }
    async postStatusFromManager({ request, response, params }) {
        let clientId = params.clientId;
        let client;
        if (!this.botService.apiStatus) {
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: 'blocked',
                target: 'status@broadcast',
                payloadSummary: `Status Post Blocked.`,
                error: 'API message sending is globally disabled.'
            });
            return response.status(403).json({ status: 'error', error: 'API message sending is disabled.' });
        }
        if (!clientId || clientId.toLowerCase() === 'any') {
            const readyClient = this.botService.getAnyReadyClient();
            if (!readyClient)
                return response.status(400).json({ status: 'error', error: 'No ready clients' });
            client = readyClient.client;
            clientId = readyClient.id;
        }
        else {
            client = this.botService.clients.get(clientId);
            if (!client || this.botService.statuses.get(clientId) !== 'ready') {
                return response.status(400).json({ status: 'error', error: `Client not ready` });
            }
        }
        const { statusType, statusText, backgroundColor, fontStyle, caption } = request.all();
        const file = request.file('file');
        try {
            if (statusType === 'text') {
                if (!statusText || statusText.trim() === '')
                    throw new Error('Status text is required and cannot be empty.');
                const args = {};
                if (backgroundColor || fontStyle !== undefined) {
                    args.extra = {};
                    if (backgroundColor)
                        args.extra.backgroundColor = backgroundColor;
                    if (fontStyle !== undefined && fontStyle !== null)
                        args.extra.fontStyle = parseInt(fontStyle, 10);
                }
                const result = await client.sendMessage('status@broadcast', statusText, args);
                const metadata = (0, SentMessage_1.getSentMessageMetadata)(result, 'status@broadcast');
                const messageId = metadata.id;
                if (messageId) {
                    await this.scheduleService.createSchedule(clientId, {
                        type: 'postTextStatus',
                        statusText,
                        backgroundColor,
                        fontStyle: fontStyle !== undefined && fontStyle !== null ? parseInt(fontStyle, 10) : undefined,
                        isRecurring: false,
                        timestamp: Date.now(),
                        lastRunAt: Date.now(),
                        statusMessageId: messageId
                    });
                }
                this.botService.logApi({
                    clientId: clientId,
                    endpoint: request.url(),
                    method: request.method(),
                    status: 'success',
                    target: 'status@broadcast',
                    payloadSummary: `Text Story: ${statusText.substring(0, 100)}`
                });
                return response.status(200).json({
                    status: 'ok',
                    success: true,
                    clientUsed: clientId,
                    messageId,
                    deliveryState: metadata.state,
                    retriesPerformed: 0,
                });
            }
            else {
                if (!file)
                    throw new Error('A media file is required to post a media status.');
                const sessionDir = Env_1.default.get('WA_SESSION_DIR');
                const customTempDir = path_1.default.join(sessionDir, 'uploads');
                if (!fs_1.default.existsSync(customTempDir))
                    fs_1.default.mkdirSync(customTempDir, { recursive: true });
                const safeName = `${Date.now()}_${file.clientName}`;
                await file.move(customTempDir, { name: safeName, overwrite: true });
                const fullPath = path_1.default.join(customTempDir, safeName);
                const media = await whatsapp_web_js_1.MessageMedia.fromFilePath(fullPath);
                media.filename = file.clientName;
                const args = {};
                if (caption)
                    args.caption = caption;
                if (statusType === 'gif')
                    args.sendVideoAsGif = true;
                if (statusType === 'audio')
                    args.sendAudioAsVoice = true;
                const result = await client.sendMessage('status@broadcast', media, args);
                fs_1.default.unlinkSync(fullPath);
                const metadata = (0, SentMessage_1.getSentMessageMetadata)(result, 'status@broadcast');
                const messageId = metadata.id;
                if (messageId) {
                    await this.scheduleService.createSchedule(clientId, {
                        type: 'postMediaStatus',
                        mediaPath: file.clientName,
                        caption,
                        isGif: statusType === 'gif',
                        isAudio: statusType === 'audio',
                        isRecurring: false,
                        timestamp: Date.now(),
                        lastRunAt: Date.now(),
                        statusMessageId: messageId
                    });
                }
                this.botService.logApi({
                    clientId: clientId,
                    endpoint: request.url(),
                    method: request.method(),
                    status: 'success',
                    target: 'status@broadcast',
                    payloadSummary: `Media Story: ${caption ? caption.substring(0, 100) : file.clientName}`
                });
                return response.status(200).json({
                    status: 'ok',
                    success: true,
                    clientUsed: clientId,
                    messageId,
                    deliveryState: metadata.state,
                    retriesPerformed: 0,
                });
            }
        }
        catch (error) {
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: 'error',
                target: 'status@broadcast',
                payloadSummary: 'Status Post Failed',
                error: error.message
            });
            return response.status(500).json({ status: 'error', success: false, error: error.message });
        }
    }
    async postStatus(ctx) {
        ctx.response.header('X-Send-Retries', '0');
        return this.postStatusFromManager(ctx);
    }
    async editMessageFromManager({ request, response, params }) {
        let clientId = params.clientId;
        let client;
        if (!this.botService.apiStatus) {
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: 'blocked',
                target: 'Edit Request',
                payloadSummary: `Message Edit Blocked.`,
                error: 'API is globally disabled.'
            });
            return response.status(403).json({ status: 'error', error: 'API message sending is disabled.' });
        }
        if (!clientId || clientId.toLowerCase() === 'any') {
            const readyClient = this.botService.getAnyReadyClient();
            if (!readyClient)
                return response.status(400).json({ status: 'error', error: 'No clients connected' });
            client = readyClient.client;
            clientId = readyClient.id;
        }
        else {
            client = this.botService.clients.get(clientId);
            if (!client || this.botService.statuses.get(clientId) !== 'ready') {
                return response.status(400).json({ status: 'error', error: `Client not ready.` });
            }
        }
        const { messageId, content, options } = request.only(['messageId', 'content', 'options']);
        if (!messageId || typeof messageId !== 'string')
            return response.badRequest({ status: 'error', error: 'messageId is required' });
        if (!content || typeof content !== 'string')
            return response.badRequest({ status: 'error', error: 'content is required' });
        try {
            const msg = await client.getMessageById(messageId);
            if (!msg)
                return response.status(404).json({ status: 'error', error: 'Message not found' });
            if (!msg.fromMe)
                return response.status(400).json({ status: 'error', error: 'Only messages sent by this WhatsApp client can be edited' });
            const stableMessageId = (0, SentMessage_1.getSentMessageId)(msg) || messageId;
            const currentBody = typeof msg.body === 'string' ? msg.body : '';
            const duplicateEdit = currentBody === content;
            const edited = duplicateEdit ? msg : await msg.edit(content, options);
            if (!edited) {
                return response.status(409).json({
                    status: 'error',
                    success: false,
                    error: 'WhatsApp did not accept this message for editing. No new message was sent.',
                    messageId: stableMessageId,
                    retriesPerformed: 0,
                });
            }
            const resultMessage = edited;
            const editedMessageId = (0, SentMessage_1.getSentMessageId)(resultMessage) || stableMessageId;
            this.botService.logApi({
                clientId,
                endpoint: request.url(),
                method: request.method(),
                status: 'success',
                target: resultMessage.to || resultMessage.from || 'unknown',
                payloadSummary: duplicateEdit
                    ? `Edit skipped because content is unchanged: ${content.substring(0, 100)}`
                    : `Edited: ${content.substring(0, 100)}`
            });
            response.header('X-Edit-Retries', '0');
            return response.json({
                status: 'ok',
                success: true,
                clientUsed: clientId,
                changed: !duplicateEdit,
                editState: duplicateEdit ? 'unchanged' : 'confirmed',
                message: {
                    id: editedMessageId,
                    chatId: resultMessage.to || resultMessage.from,
                    timestamp: resultMessage.timestamp,
                },
            });
        }
        catch (error) {
            this.botService.logApi({
                clientId,
                endpoint: request.url(),
                method: request.method(),
                status: 'error',
                target: 'Edit Request',
                payloadSummary: 'Edit Failed',
                error: error.message
            });
            return response.status(500).json({ status: 'error', success: false, error: error.message });
        }
    }
    async editMessage(ctx) {
        return this.editMessageFromManager(ctx);
    }
    async deleteMessageFromManager({ request, response, params }) {
        let clientId = params.clientId;
        let client;
        if (!this.botService.apiStatus) {
            this.botService.logApi({
                clientId: clientId || 'any',
                endpoint: request.url(),
                method: request.method(),
                status: 'blocked',
                target: 'Delete Request',
                payloadSummary: `Message Delete Blocked.`,
                error: 'API is globally disabled.'
            });
            return response.status(403).json({ status: 'error', error: 'API message sending is disabled.' });
        }
        if (!clientId || clientId.toLowerCase() === 'any') {
            const readyClient = this.botService.getAnyReadyClient();
            if (!readyClient)
                return response.status(400).json({ status: 'error', error: 'No clients connected' });
            client = readyClient.client;
            clientId = readyClient.id;
        }
        else {
            client = this.botService.clients.get(clientId);
            if (!client || this.botService.statuses.get(clientId) !== 'ready') {
                return response.status(400).json({ status: 'error', error: `Client not ready.` });
            }
        }
        const { messageId, everyone, clearMedia } = request.only(['messageId', 'everyone', 'clearMedia']);
        if (!messageId || typeof messageId !== 'string')
            return response.badRequest({ status: 'error', error: 'messageId is required' });
        const shouldDeleteForEveryone = this.parseBoolean(everyone, true);
        const shouldClearMedia = this.parseBoolean(clearMedia, true);
        try {
            const msg = await client.getMessageById(messageId);
            if (!msg)
                return response.status(404).json({ status: 'error', error: 'Message not found' });
            const chatId = msg.fromMe ? msg.to : msg.from;
            await msg.delete(shouldDeleteForEveryone, shouldClearMedia);
            this.botService.logApi({
                clientId,
                endpoint: request.url(),
                method: request.method(),
                status: 'success',
                target: chatId || 'Delete Request',
                payloadSummary: `Deleted: ${messageId}`
            });
            return response.json({
                status: 'ok',
                success: true,
                clientUsed: clientId,
                deleted: true,
                message: { id: messageId, chatId, everyone: shouldDeleteForEveryone, clearMedia: shouldClearMedia },
            });
        }
        catch (error) {
            this.botService.logApi({
                clientId,
                endpoint: request.url(),
                method: request.method(),
                status: 'error',
                target: 'Delete Request',
                payloadSummary: 'Delete Failed',
                error: error.message
            });
            return response.status(500).json({ status: 'error', success: false, error: error.message });
        }
    }
    async deleteMessage(ctx) {
        return this.deleteMessageFromManager(ctx);
    }
    async integrationListInstances({ request, response }) {
        return response.json({
            status: 'ok',
            success: true,
            instances: this.botService.listIntegrationDetails(this.getIntegrationBaseUrl(request))
        });
    }
    async integrationRegisterInstance({ request, response }) {
        try {
            const payload = request.all();
            const clientId = payload.clientId ? String(payload.clientId).trim() : undefined;
            if (clientId)
                this.validateClientId(clientId);
            this.validateCommandFiles(payload.commandFiles);
            const idempotencyKey = request.header('idempotency-key') || payload.idempotencyKey;
            const result = await this.botService.registerIntegrationClient({
                clientId,
                externalClientId: payload.externalClientId,
                displayName: payload.displayName,
                commandFiles: payload.commandFiles,
                commandRules: payload.commandRules,
                webhookUrl: payload.webhookUrl,
                allowedOrigins: payload.allowedOrigins,
                metadata: payload.metadata,
                idempotencyKey,
                issueToken: payload.issueToken !== false && payload.issueToken !== 'false'
            });
            const instance = this.botService.getIntegrationDetails(result.clientId, this.getIntegrationBaseUrl(request), true);
            return response.status(result.created ? 201 : 200).json({
                status: 'ok',
                success: true,
                created: result.created,
                idempotent: result.idempotent,
                instance,
                credentials: {
                    token: result.token,
                    tokenReturnedOnce: Boolean(result.token),
                    note: result.token ? 'Optional legacy credential; API access does not require it.' : 'No new token was returned. Existing tokens are never exposed again; rotate the token when necessary.'
                }
            });
        }
        catch (error) {
            return this.jsonError(response, 422, 'INVALID_INSTANCE_REGISTRATION', error.message);
        }
    }
    async integrationGetInstance({ request, response, params }) {
        const instance = this.botService.getIntegrationDetails(params.clientId, this.getIntegrationBaseUrl(request), true);
        if (!instance)
            return this.jsonError(response, 404, 'INSTANCE_NOT_FOUND', `Instance '${params.clientId}' does not exist.`);
        return response.json({ status: 'ok', success: true, instance });
    }
    async integrationGetStatus({ request, response, params }) {
        const instance = this.botService.getIntegrationDetails(params.clientId, this.getIntegrationBaseUrl(request), false);
        if (!instance)
            return this.jsonError(response, 404, 'INSTANCE_NOT_FOUND', `Instance '${params.clientId}' does not exist.`);
        return response.json({
            status: 'ok',
            success: true,
            instance: {
                clientId: instance.clientId,
                integrationId: instance.integrationId,
                status: instance.status,
                statusLabel: instance.statusLabel,
                qr: instance.qr,
                session: instance.session,
                health: instance.health
            }
        });
    }
    async integrationGetQr({ response, params }) {
        const qrState = this.botService.getQrState(params.clientId);
        if (!qrState)
            return this.jsonError(response, 404, 'INSTANCE_NOT_FOUND', `Instance '${params.clientId}' does not exist.`);
        return response.json({ status: 'ok', success: true, qr: qrState });
    }
    async integrationQrStream({ request, response, params }) {
        if (!this.botService.configs.has(params.clientId)) {
            return this.jsonError(response, 404, 'INSTANCE_NOT_FOUND', `Instance '${params.clientId}' does not exist.`);
        }
        const res = response.response;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const writeState = () => {
            res.write(`event: qr\ndata: ${JSON.stringify(this.botService.getQrState(params.clientId))}\n\n`);
        };
        writeState();
        const interval = setInterval(writeState, 2000);
        if (request.request && typeof request.request.on === 'function') {
            request.request.on('close', () => clearInterval(interval));
        }
    }
    async integrationConfigureInstance({ request, response, params }) {
        try {
            const payload = request.all();
            this.validateCommandFiles(payload.commandFiles);
            await this.botService.updateIntegrationConfig(params.clientId, {
                externalClientId: payload.externalClientId,
                displayName: payload.displayName,
                commandFiles: payload.commandFiles,
                commandRules: payload.commandRules,
                webhookUrl: payload.webhookUrl,
                allowedOrigins: payload.allowedOrigins,
                metadata: payload.metadata,
            });
            return response.json({
                status: 'ok',
                success: true,
                instance: this.botService.getIntegrationDetails(params.clientId, this.getIntegrationBaseUrl(request), true)
            });
        }
        catch (error) {
            const statusCode = error.message && error.message.includes('does not exist') ? 404 : 422;
            return this.jsonError(response, statusCode, statusCode === 404 ? 'INSTANCE_NOT_FOUND' : 'INVALID_CONFIGURATION', error.message);
        }
    }
    async integrationReconnectInstanceFromManager({ request, response, params }) {
        try {
            await this.botService.reconnectClient(params.clientId);
            return response.status(202).json({
                status: 'ok',
                success: true,
                message: 'Reconnect requested.',
                instance: this.botService.getIntegrationDetails(params.clientId, this.getIntegrationBaseUrl(request), false)
            });
        }
        catch (error) {
            return this.jsonError(response, 404, 'INSTANCE_NOT_FOUND', error.message);
        }
    }
    async integrationRotateTokenFromManager({ request, response, params }) {
        try {
            const token = await this.botService.rotateIntegrationToken(params.clientId);
            return response.json({
                status: 'ok',
                success: true,
                credentials: {
                    token,
                    tokenReturnedOnce: true,
                    note: 'Optional legacy credential; API access does not require it.'
                },
                instance: this.botService.getIntegrationDetails(params.clientId, this.getIntegrationBaseUrl(request), false)
            });
        }
        catch (error) {
            return this.jsonError(response, 404, 'INSTANCE_NOT_FOUND', error.message);
        }
    }
    async integrationReconnectInstance(ctx) {
        return this.integrationReconnectInstanceFromManager(ctx);
    }
    async integrationRotateToken(ctx) {
        return this.integrationRotateTokenFromManager(ctx);
    }
    async integrationSendMessage(ctx) {
        return this.sendMessages(ctx);
    }
    async integrationPostStory(ctx) {
        return this.postStatus(ctx);
    }
    async qr({ request, response }) {
        const res = response.response;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const interval = setInterval(() => {
            res.write(`data: ${JSON.stringify({
                qr: Object.fromEntries(this.botService.qrCodes),
                status: Object.fromEntries(this.botService.statuses),
                runtimeState: Object.fromEntries(this.botService.runtimeStates),
            })}\n\n`);
        }, 2000);
        if (request.request && typeof request.request.on === 'function') {
            request.request.on('close', () => clearInterval(interval));
        }
    }
}
exports.default = BotController;
//# sourceMappingURL=BotController.js.map