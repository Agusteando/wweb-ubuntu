"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const Application_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Application"));
const uuid_1 = require("uuid");
const whatsapp_web_js_1 = require("whatsapp-web.js");
class ScheduleService {
    constructor() {
        this.schedules = [];
        this.timer = null;
        this.file = path_1.default.join(Env_1.default.get('WA_SESSION_DIR'), 'schedules.json');
    }
    async init() {
        try {
            const data = await fs_1.promises.readFile(this.file, 'utf8');
            this.schedules = JSON.parse(data);
            for (const s of this.schedules) {
                if (s.type === 'setStatus' || s.type === 'postStatus') {
                    s.type = s.mediaPath ? 'postMediaStatus' : 'postTextStatus';
                }
                if (s.type === 'evokeStatus')
                    s.type = 'revokeStatus';
            }
        }
        catch (e) {
            this.schedules = [];
        }
        this.startTimer();
    }
    startTimer() {
        const now = new Date();
        const msUntilNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
        setTimeout(() => {
            this.tick();
            this.timer = setInterval(() => this.tick(), 60000);
        }, msUntilNextMinute);
    }
    async shutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async tick() {
        const now = new Date();
        const nowMs = now.getTime();
        const currentH = now.getHours();
        const currentM = now.getMinutes();
        const currentDOW = now.getDay();
        const currentDOM = now.getDate();
        const timeStr = `${currentH.toString().padStart(2, '0')}:${currentM.toString().padStart(2, '0')}`;
        let updated = false;
        for (const s of this.schedules) {
            let shouldRun = false;
            if (!s.isRecurring && s.timestamp) {
                if (s.timestamp <= nowMs && (!s.lastRunAt || s.lastRunAt < s.timestamp)) {
                    shouldRun = true;
                }
            }
            else if (s.isRecurring && s.recurrence) {
                if (s.recurrence.time === timeStr) {
                    if (s.recurrence.type === 'daily')
                        shouldRun = true;
                    if (s.recurrence.type === 'weekly' && s.recurrence.daysOfWeek?.includes(currentDOW))
                        shouldRun = true;
                    if (s.recurrence.type === 'monthly' && s.recurrence.dayOfMonth === currentDOM)
                        shouldRun = true;
                }
            }
            if (shouldRun) {
                if (s.lastRunAt && nowMs - s.lastRunAt < 50000)
                    continue;
                s.lastRunAt = nowMs;
                updated = true;
                this.executeSchedule(s).catch(err => console.error(`[Scheduler] Event ${s.id} failed:`, err));
            }
        }
        if (updated)
            await this.save();
    }
    async executeSchedule(s) {
        const botService = Application_1.default.container.use('App/Services/BotService');
        const client = botService.clients.get(s.clientId);
        if (!client || botService.statuses.get(s.clientId) !== 'ready')
            return;
        if (s.type === 'message' && s.chatIds && s.chatIds.length > 0) {
            let msgContent = s.message || '';
            const args = {};
            if (s.mediaPath) {
                try {
                    if (s.mediaPath.startsWith('http')) {
                        msgContent = await whatsapp_web_js_1.MessageMedia.fromUrl(s.mediaPath);
                    }
                    else {
                        msgContent = whatsapp_web_js_1.MessageMedia.fromFilePath(s.mediaPath);
                    }
                    if (s.filename)
                        msgContent.filename = s.filename;
                    if (s.message)
                        args.caption = s.message;
                }
                catch (e) {
                    console.error(`[Scheduler] Media load failed for schedule ${s.id}:`, e);
                }
            }
            for (const chatId of s.chatIds) {
                try {
                    await client.sendMessage(chatId, msgContent, args);
                }
                catch (e) {
                    console.error(`[Scheduler] Failed to send scheduled msg to ${chatId}:`, e);
                }
            }
        }
        else if (s.type === 'postTextStatus') {
            if (!s.statusText || s.statusText.trim() === '') {
                console.error(`[Scheduler] Aborted text status ${s.id}: Body was completely empty.`);
                return;
            }
            const args = {};
            if (s.backgroundColor || s.fontStyle !== undefined) {
                args.extra = {};
                if (s.backgroundColor)
                    args.extra.backgroundColor = s.backgroundColor;
                if (s.fontStyle !== undefined && s.fontStyle !== null) {
                    args.extra.fontStyle = Number(s.fontStyle);
                }
            }
            try {
                const result = await client.sendMessage('status@broadcast', s.statusText, args);
                if (result) {
                    s.statusMessageId = result.id?._serialized ?? result.id;
                    await this.save();
                }
            }
            catch (e) {
                console.error(`[Scheduler] Failed to post text status broadcast:`, e);
            }
        }
        else if (s.type === 'postMediaStatus') {
            if (!s.mediaPath) {
                console.error(`[Scheduler] Aborted media status ${s.id}: Path was completely empty.`);
                return;
            }
            let msgContent = null;
            const args = {};
            try {
                if (s.mediaPath.startsWith('http')) {
                    msgContent = await whatsapp_web_js_1.MessageMedia.fromUrl(s.mediaPath);
                }
                else {
                    msgContent = whatsapp_web_js_1.MessageMedia.fromFilePath(s.mediaPath);
                }
                if (s.caption)
                    args.caption = s.caption;
                if (s.isGif)
                    args.sendVideoAsGif = true;
                if (s.isAudio)
                    args.sendAudioAsVoice = true;
                const result = await client.sendMessage('status@broadcast', msgContent, args);
                if (result) {
                    s.statusMessageId = result.id?._serialized ?? result.id;
                    await this.save();
                }
            }
            catch (e) {
                console.error(`[Scheduler] Failed to load/send media status ${s.id}:`, e);
            }
        }
        else if (s.type === 'revokeStatus' && s.revokeMessageId) {
            try {
                await client.revokeStatusMessage(s.revokeMessageId);
            }
            catch (e) {
                console.error(`[Scheduler] Failed to revoke status broadcast:`, e);
            }
        }
    }
    async save() {
        await fs_1.promises.writeFile(this.file, JSON.stringify(this.schedules, null, 2), 'utf8');
    }
    getSchedulesForClient(clientId) {
        return this.schedules.filter(s => s.clientId === clientId);
    }
    async createSchedule(clientId, data) {
        const s = {
            ...data,
            id: (0, uuid_1.v4)(),
            clientId,
            createdAt: Date.now()
        };
        this.schedules.push(s);
        await this.save();
        return s;
    }
    async updateSchedule(clientId, id, data) {
        const idx = this.schedules.findIndex(s => s.id === id && s.clientId === clientId);
        if (idx !== -1) {
            this.schedules[idx] = { ...this.schedules[idx], ...data };
            await this.save();
            return this.schedules[idx];
        }
        throw new Error('Schedule not found');
    }
    async deleteSchedule(clientId, id) {
        this.schedules = this.schedules.filter(s => !(s.id === id && s.clientId === clientId));
        await this.save();
    }
    async deleteAllSchedules(clientId) {
        this.schedules = this.schedules.filter(s => s.clientId !== clientId);
        await this.save();
    }
    async bulkCreate(clientId, items) {
        const added = [];
        for (const item of items) {
            const s = {
                ...item,
                id: (0, uuid_1.v4)(),
                clientId,
                createdAt: Date.now()
            };
            added.push(s);
            this.schedules.push(s);
        }
        await this.save();
        return added;
    }
}
exports.default = ScheduleService;
//# sourceMappingURL=ScheduleService.js.map