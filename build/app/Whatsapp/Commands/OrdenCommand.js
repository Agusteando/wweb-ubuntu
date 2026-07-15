"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const axios_1 = __importDefault(require("axios"));
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
function extractOrdenFromText(s) {
    return (s || '').toString().trim();
}
class OrdenCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!orden <folio> o responde a un mensaje con el folio y escribe !orden';
    }
    async handle(message, client, _session) {
        const body = message.body || '';
        const lowerBody = body.toLowerCase();
        if (!lowerBody.startsWith('!orden') && !lowerBody.startsWith('/orden')) {
            return;
        }
        let orden = '';
        if (message.hasQuotedMsg) {
            const quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'OrdenCommand');
            if (quotedMsg)
                orden = extractOrdenFromText(quotedMsg.body);
        }
        else {
            const textWithoutCmd = body.replace(/^(!|\/)orden\b/i, '').trim();
            orden = extractOrdenFromText(textWithoutCmd);
        }
        if (!orden) {
            await message.reply('Uso: !orden <folio>\nO responde a un mensaje con el folio y escribe !orden');
            return;
        }
        const url = `https://compras.casitaapps.com/fpdf_orden.php?ver=${encodeURIComponent(orden)}`;
        const filename = `${orden}.pdf`;
        try {
            const response = await axios_1.default.get(url, {
                responseType: 'arraybuffer',
                validateStatus: () => true
            });
            if (response.status !== 200) {
                await message.reply(`No se pudo obtener el PDF (HTTP ${response.status}).`);
                return;
            }
            const buffer = Buffer.from(response.data, 'binary');
            if (!buffer.length || buffer.length < 100) {
                await message.reply('El PDF recibido está vacío o inválido.');
                return;
            }
            const base64Data = buffer.toString('base64');
            const media = new whatsapp_web_js_1.MessageMedia('application/pdf', base64Data, filename);
            await client.sendMessage(message.from, media, {
                caption: `Orden: ${orden}`,
                quotedMessageId: message.id._serialized
            });
        }
        catch (error) {
            console.error('[orden] error:', error);
            await message.reply('Sorry, hubo un error procesando tu solicitud.');
        }
    }
}
exports.default = OrdenCommand;
//# sourceMappingURL=OrdenCommand.js.map