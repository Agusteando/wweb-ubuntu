"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const fs_1 = __importDefault(require("fs"));
class AudioTranscriptionAutomation {
    constructor() {
        this.type = 'Automation';
        this.instructions = 'Transcribes PTT/Audio messages using OpenAI Whisper for configured groups or DMs';
        this.preventUnwanted = false;
        this.botIsReplying = false;
    }
    async handle(message, _client, session) {
        if (message.isStatus || message.from === 'status@broadcast' || message.to === 'status@broadcast') {
            return;
        }
        if (message.hasMedia && !session.skip &&
            (message.type === 'ptt' || (message.type === 'audio' && !this.preventUnwanted))) {
            try {
                if (this.botIsReplying)
                    return;
                const predictionResult = await (0, Utils_1.createAudioPrediction2)(message);
                session.skip = false;
                if (predictionResult && predictionResult.transcription) {
                    await message.reply(`🎙️ *Transcripción:* \n${predictionResult.transcription}`);
                    if (predictionResult.audioFilePath && fs_1.default.existsSync(predictionResult.audioFilePath)) {
                        fs_1.default.unlinkSync(predictionResult.audioFilePath);
                    }
                }
            }
            catch (err) {
                console.error('Error while processing the audio message with Whisper:', err);
            }
        }
    }
}
exports.default = AudioTranscriptionAutomation;
//# sourceMappingURL=AudioTranscriptionAutomation.js.map