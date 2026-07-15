"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class MediaAutomation {
    constructor() {
        this.type = 'Automation';
        this.instructions = 'Converts PDF/Word for specific remote and auto-stores PDFs';
    }
    async handle(message, _client, session) {
        if (message.hasMedia) {
            try {
                const media = await (0, QuotedMessage_1.downloadMessageMediaSafely)(message, 'MediaAutomation');
                if (!media)
                    return;
                const mimeType = media.mimetype;
                if (mimeType === 'application/pdf' && message.id.remote === '5217221495782@c.us') {
                    const convertedToWord = await (0, Utils_1.convertPdfToWord)(media, message);
                    if (!convertedToWord) {
                        await (0, Utils_1.convertWordToPdf)(media, message);
                    }
                }
                if (session.autoStorePDF) {
                    if (mimeType === 'application/pdf') {
                        if (!session.adjuntados)
                            session.adjuntados = [];
                        session.adjuntados.push(media);
                        await message.reply(`PDF adjuntado automáticamente. Ahora hay ${session.adjuntados.length} archivos adjuntos.`);
                    }
                }
                else if (mimeType === 'application/pdf') {
                    if (!Array.isArray(session.alternateAdjuntados)) {
                        session.alternateAdjuntados = [];
                    }
                    if (session.alternateAdjuntados.length >= 10) {
                        session.alternateAdjuntados.shift();
                    }
                    session.alternateAdjuntados.push(media);
                }
            }
            catch (e) {
                console.error('Error processing media:', e);
            }
        }
    }
}
exports.default = MediaAutomation;
//# sourceMappingURL=MediaAutomation.js.map