"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const axios_1 = __importDefault(require("axios"));
class VisitsCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!visits - Fetches visits chart from bot.casitaapps.com';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        if (body.startsWith('!visits')) {
            try {
                const endpoint = "https://bot.casitaapps.com/visits";
                const response = await axios_1.default.get(endpoint, { responseType: 'arraybuffer' });
                if (response.data) {
                    const b64data = Buffer.from(response.data, 'binary').toString('base64');
                    const mimetype = response.headers['content-type'] || 'image/png';
                    const msg = new whatsapp_web_js_1.MessageMedia(mimetype, b64data);
                    await message.reply(msg);
                }
                else {
                    await message.reply("No data available or error fetching chart data.");
                }
            }
            catch (error) {
                await message.reply("An error occurred while processing the request.");
            }
        }
    }
}
exports.default = VisitsCommand;
//# sourceMappingURL=VisitsCommand.js.map