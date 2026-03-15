import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { createAudioPrediction2 } from '../../Services/Utils'
import fs from 'fs'

export default class AudioTranscriptionAutomation {
  public type = 'Automation'
  public instructions = 'Transcribes PTT/Audio messages for specific groups or DMs'

  private preventUnwanted = false;
  private botIsReplying = false;

  async handle(message: Message, _client: Client, session: UserSession) {
    const allowedGroups = ['120363025945746778@g.us', '120363164004982656@g.us']
    
    if ((allowedGroups.includes(message.id.remote) || !message.id.remote.includes('@g.us')) && 
        message.hasMedia && !session.skip && 
        (message.type === 'ptt' || (message.type === 'audio' && !this.preventUnwanted))) {
        try {
            if (this.botIsReplying) return;

            const predictionResult = await createAudioPrediction2(message);
            session.skip = false;

            if (predictionResult && predictionResult.transcription) {
                await message.reply(`🎙️ *Transcripción:* \n${predictionResult.transcription}`)
                
                if (predictionResult.audioFilePath && fs.existsSync(predictionResult.audioFilePath)) {
                    fs.unlinkSync(predictionResult.audioFilePath);
                }
            }
        } catch (err: any) {
            console.error('Error while processing the audio message:', err);
        }
    }
  }
}