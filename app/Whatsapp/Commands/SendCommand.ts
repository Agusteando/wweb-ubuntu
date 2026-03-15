import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { sendEmail } from '../../Services/Utils'

export default class SendCommand {
  public type = 'Command'
  public instructions = '!send <to: email> <subject: text> - Sends email with attached media if quoted'

  async handle(message: Message, _client: Client, session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd === '!send' || cmd === '!email') {
        try {
            if (!session.adjuntados) session.adjuntados = []

            var argumentos = body.replace(cmd, "").replace('🐺', '').trim().split(/\s(?=\w+:)/)
                .reduce((acc: any, el: string) => {
                    const parts = el.split(/:(.+)/);
                    const key = parts[0];
                    const value = parts[1];
                    if (key && value) acc[key.trim()] = value.trim();
                    return acc;
                }, {});

            if (message.hasQuotedMsg) {
                var quotedMsg = await message.getQuotedMessage();
                argumentos.message = quotedMsg.body.replace(/\n/g, "<br>");
                if (quotedMsg.hasMedia) {
                    var media = await quotedMsg.downloadMedia();
                    session.adjuntados.push(media);
                    message.reply("Archivo adjuntado exitosamente");
                }
            }
            
            argumentos.files = session.adjuntados;

            var result = await sendEmail(argumentos);

            if (result && result.status == 200) {
                message.reply("Correo enviado a *" + argumentos.to + "* ✅");
                session.adjuntados = [];
            } else {
                message.reply("Error al enviar correo: " + JSON.stringify(result));
            }
        } catch (error: any) {
            message.reply(error.message);
        }
    }
  }
}