import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { convertPdfToWord, convertWordToPdf } from '../../Services/Utils'

export default class MediaAutomation {
  public type = 'Automation'
  public instructions = 'Converts PDF/Word for specific remote and auto-stores PDFs'

  async handle(message: Message, client: Client, session: UserSession) {
    if (message.hasMedia) {
        try {
            const media = await message.downloadMedia();
            if (!media) return;
            const mimeType = media.mimetype;

            if (mimeType === 'application/pdf' && message.id.remote === '5217221495782@c.us') {
                const convertedToWord = await convertPdfToWord(media, message);
                if (!convertedToWord) {
                    await convertWordToPdf(media, message);
                }
            }

            if (session.autoStorePDF) {
                if (mimeType === 'application/pdf') {
                    if (!session.adjuntados) session.adjuntados = [];
                    session.adjuntados.push(media);
                    await message.reply(`PDF adjuntado automáticamente. Ahora hay ${session.adjuntados.length} archivos adjuntos.`);
                }
            } else if (mimeType === 'application/pdf') {
                if (!Array.isArray(session.alternateAdjuntados)) {
                    session.alternateAdjuntados = [];
                }
                if (session.alternateAdjuntados.length >= 10) {
                    session.alternateAdjuntados.shift();
                }
                session.alternateAdjuntados.push(media);
            }
        } catch (e) {
            console.error('Error processing media:', e);
        }
    }
  }
}