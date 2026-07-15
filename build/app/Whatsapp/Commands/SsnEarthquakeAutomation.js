"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const xml2js = require('xml2js');
const DEFAULT_SSN_RSS_URL = 'http://www.ssn.unam.mx/rss/ultimos-sismos.xml';
const DEFAULT_MAJOR_ALERT_CHAT_IDS = [
    '5217223784886-1598620689@g.us',
    '5217221508888-1431783389@g.us',
];
const DEFAULT_MINOR_ALERT_CHAT_IDS = ['5217291065569@c.us'];
class SsnEarthquakeAutomation {
    constructor() {
        this.type = 'Automation';
        this.instructions = 'Monitorea el RSS del SSN cada minuto y envía alertas de sismos nuevos.';
        this.timer = null;
        this.lastTitle = null;
        this.isChecking = false;
    }
    async start(client, clientId) {
        if (this.timer)
            return;
        await this.checkSSN(client, clientId);
        this.timer = setInterval(() => {
            void this.checkSSN(client, clientId);
        }, this.getIntervalMs());
        console.log(`[SSN][${clientId}] Earthquake automation started.`);
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    getIntervalMs() {
        const configured = Number(Env_1.default.get('SSN_CHECK_INTERVAL_MS') || 60000);
        return Number.isFinite(configured) && configured >= 30000 ? configured : 60000;
    }
    getMajorThreshold() {
        const configured = Number(Env_1.default.get('SSN_MAJOR_MAGNITUDE_THRESHOLD') || 6);
        return Number.isFinite(configured) ? configured : 6;
    }
    getFeedUrl() {
        return Env_1.default.get('SSN_RSS_URL') || DEFAULT_SSN_RSS_URL;
    }
    getChatIds(envName, defaults) {
        const configured = Env_1.default.get(envName);
        if (!configured)
            return defaults;
        const parsed = configured
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        return parsed.length > 0 ? parsed : defaults;
    }
    getTitleValue(item) {
        const rawTitle = Array.isArray(item?.title) ? item.title[0] : item?.title;
        const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
        return title || null;
    }
    parseMagnitude(title) {
        const normalized = title.replace(/,/g, ' ');
        const match = normalized.match(/(?:^|\s)(?:Preliminar:\s*)?M\s*([0-9]+(?:\.[0-9]+)?)/i)
            || normalized.match(/^\s*([0-9]+(?:\.[0-9]+)?)/);
        return match ? Number(match[1]) : 0;
    }
    async sendToMany(client, chatIds, text) {
        for (const chatId of chatIds) {
            try {
                await client.sendMessage(chatId, text, { waitUntilMsgSent: true });
            }
            catch (err) {
                console.error(`[SSN] Could not send alert to ${chatId}:`, err?.message || err);
            }
        }
    }
    async checkSSN(client, clientId) {
        if (this.isChecking)
            return;
        this.isChecking = true;
        try {
            const body = await axios_1.default
                .get(this.getFeedUrl(), {
                responseType: 'text',
                timeout: 15000,
                headers: { 'User-Agent': 'casita-whatsapp-bot/1.0' },
            })
                .then((res) => String(res.data || ''));
            const xml = await xml2js.parseStringPromise(body, { trim: true });
            const items = xml?.rss?.channel?.[0]?.item || [];
            if (!Array.isArray(items) || items.length === 0)
                return;
            const title = this.getTitleValue(items[0]);
            if (!title)
                return;
            if (!this.lastTitle) {
                this.lastTitle = title;
                return;
            }
            if (title === this.lastTitle)
                return;
            const magnitude = this.parseMagnitude(title);
            const threshold = this.getMajorThreshold();
            if (items.length === 1 && magnitude > threshold) {
                await this.sendToMany(client, this.getChatIds('SSN_MAJOR_ALERT_CHAT_IDS', DEFAULT_MAJOR_ALERT_CHAT_IDS), `🚨🚨🚨 Alerta *sismo* Tiempo Real\n\n*${title}*`);
                console.log(`[SSN][${clientId}] Sent major alert: ${title}`);
            }
            else {
                await this.sendToMany(client, this.getChatIds('SSN_MINOR_ALERT_CHAT_IDS', DEFAULT_MINOR_ALERT_CHAT_IDS), `🚨 Alerta sismo *menor* Tiempo Real\n\n*${title}*`);
                console.log(`[SSN][${clientId}] Sent minor alert: ${title}`);
            }
            this.lastTitle = title;
        }
        catch (err) {
            console.warn(`[SSN][${clientId}] error:`, err?.message || err);
        }
        finally {
            this.isChecking = false;
        }
    }
}
exports.default = SsnEarthquakeAutomation;
//# sourceMappingURL=SsnEarthquakeAutomation.js.map