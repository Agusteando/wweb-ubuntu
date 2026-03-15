import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import axios from 'axios'

export default class VisitsCommand {
  public type = 'Command'
  public instructions = '!visits - Fetches visits chart from bot.casitaapps.com'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    if (body.startsWith('!visits')) {
        try {
            const endpoint = "https://bot.casitaapps.com/visits";
            const response = await axios.get(endpoint, { responseType: 'arraybuffer' });
            
            if (response.data) {
                const b64data = Buffer.from(response.data, 'binary').toString('base64');
                const mimetype = response.headers['content-type'] || 'image/png';
                const msg = new MessageMedia(mimetype, b64data);
                await message.reply(msg);
            } else {
                await message.reply("No data available or error fetching chart data.");
            }
        } catch (error: any) {
            await message.reply("An error occurred while processing the request.");
        }
    }
  }
}