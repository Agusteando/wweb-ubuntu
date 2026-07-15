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
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const QRCode = __importStar(require("qrcode"));
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class QrCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!qr (Responda a un mensaje con un enlace) - Genera un QR en PNG de alta calidad.';
    }
    extractFirstLink(text) {
        const match = text.match(/\b((?:https?:\/\/|www\.)[^\s<>"']+)/i);
        if (!match || !match[1])
            return null;
        const rawUrl = match[1].replace(/[),.;!?\]}>"']+$/g, '');
        const normalizedUrl = rawUrl.toLowerCase().startsWith('www.') ? `https://${rawUrl}` : rawUrl;
        try {
            const parsedUrl = new URL(normalizedUrl);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
                return null;
            return parsedUrl.toString();
        }
        catch (_error) {
            return null;
        }
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!qr')
            return;
        if (!message.hasQuotedMsg) {
            await message.reply('Responde a un mensaje que contenga un enlace y escribe `!qr`.');
            return;
        }
        const quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'QrCommand');
        if (!quotedMsg) {
            await message.reply('No fue posible recuperar el mensaje citado. Vuelva a citarlo e inténtelo nuevamente.');
            return;
        }
        const quotedText = quotedMsg.body || '';
        const link = this.extractFirstLink(quotedText);
        if (!link) {
            await message.reply('El mensaje citado no contiene un enlace válido con http://, https:// o www.');
            return;
        }
        try {
            const qrBuffer = await QRCode.toBuffer(link, {
                errorCorrectionLevel: 'H',
                width: 1024,
                margin: 3,
                color: {
                    dark: '#111827',
                    light: '#FFFFFF'
                }
            });
            const qrMedia = new whatsapp_web_js_1.MessageMedia('image/png', qrBuffer.toString('base64'), 'qr-link.png');
            await message.reply(qrMedia, undefined, { caption: `QR generado para:\n${link}` });
        }
        catch (error) {
            console.error('Error generating QR:', error);
            await message.reply('No se pudo generar el QR para ese enlace.');
        }
    }
}
exports.default = QrCommand;
//# sourceMappingURL=QrCommand.js.map