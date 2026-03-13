import { Message, Client } from 'whatsapp-web.js'
import { UserSession } from '../Services/SessionManager'
import { convertPdfToWord, convertWordToPdf, createAudioPrediction2 } from '../Services/Utils'
import fs from 'fs'

export default class Automations {
  public static async run(message: Message, client: Client, session: UserSession) {
    if (message.hasMedia) {
      try {
        const media = await message.downloadMedia()
        if (!media) return
        const mimeType = media.mimetype

        // Automations for Specific Remote ID (PDF / Word)
        if (message.id.remote === '5217221495782@c.us') {
          if (mimeType === 'application/pdf') {
            const convertedToWord = await convertPdfToWord(media, message)
            if (!convertedToWord) await convertWordToPdf(media, message)
          }
        }

        // Auto-Store Logic
        if (mimeType === 'application/pdf') {
          if (session.autoStorePDF) {
            session.adjuntados.push(media)
            await message.reply(`PDF adjuntado automáticamente. Hay ${session.adjuntados.length} archivos.`)
          } else {
            if (session.alternateAdjuntados.length >= 10) session.alternateAdjuntados.shift()
            session.alternateAdjuntados.push(media)
          }
        }
      } catch (e) {
        console.error("Error processing media automation:", e)
      }
    }

    // Audio Transcription
    const allowedGroups = ['120363025945746778@g.us', '120363164004982656@g.us']
    if ((allowedGroups.includes(message.id.remote) || !message.id.remote.includes('@g.us')) 
        && message.hasMedia && !session.skip && (message.type === 'ptt' || message.type === 'audio')) {
      
      try {
        const prediction = await createAudioPrediction2(message)
        session.skip = false

        if (prediction && prediction.transcription) {
          await message.reply(`🎙️ *Transcripción:* \n${prediction.transcription}`)
          
          if (prediction.audioFilePath && fs.existsSync(prediction.audioFilePath)) {
            fs.unlinkSync(prediction.audioFilePath)
          }
        }
      } catch (e) {
        console.error("Audio prediction failed:", e)
      }
    }
  }
}