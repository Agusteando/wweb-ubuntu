import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { createAudioPrediction2 } from '../../Services/Utils'
import fs from 'fs'

export default class AudioTranscriptionAutomation {
  public type = 'Automation'
  public instructions = 'Transcribes PTT/Audio messages for configured groups or DMs'

  private preventUnwanted = false;
  private botIsReplying = false;

  async handle(message: Message, _client: Client, session: UserSession) {
    // Note: Group filtering is now dynamically handled globally in CommandRegistry based on Include rules.
    if (message.hasMedia && !session.skip && 
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