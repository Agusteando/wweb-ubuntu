// filepath: app/Whatsapp/Commands/SendCommand.ts
import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { sendEmail } from 'App/Services/Utils'

export default class SendCommand {
  public type = 'Command'
  public instructions = '!send <to: email> <subject: text> - Sends email with attached media if quoted'

  async handle(message: Message, _client: Client, session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd === '!send' || cmd === '!email') {
        try {
            if (!session.adjuntados) session.adjuntados = []
            console.log("Before !send, adjuntados:", session.adjuntados);

            var argumentos = body.replace(new RegExp(`^${cmd}`, 'i'), "").replace('🐺', '').trim().split(/\s(?=\w+:)/)
                .reduce((acc: any, el: string) => {
                    const parts = el.split(/:(.+)/);
                    const key = parts[0];
                    // Slice and rejoin in case the target value inherently includes colons (e.g. URLs or times)
                    const value = parts.slice(1).join(':'); 
                    if (key && value) acc[key.trim()] = value.trim();
                    return acc;
                }, {});

            if (message.hasQuotedMsg) {
                var quotedMsg = await message.getQuotedMessage();
                const bodyText = quotedMsg.body || '';
                argumentos.message = bodyText.replace(/\n/g, "<br>");
                
                if (quotedMsg.hasMedia) {
                    var media = await quotedMsg.downloadMedia();
                    session.adjuntados.push(media);
                    await message.reply("Archivo adjuntado exitosamente");
                }
                argumentos.files = session.adjuntados;
            } else {
                argumentos.files = session.adjuntados;
            }

            var result = await sendEmail(argumentos);
            console.log('Result from sendEmail:', result);

            if (result && result.status == 200) {
                await message.reply("Correo enviado a *" + (argumentos.to || 'aguswubslyn@gmail.com') + "* ✅");
                session.adjuntados = [];
            } else {
                await message.reply("Error al enviar correo: " + JSON.stringify(result));
            }

            console.log("After !send, adjuntados:", session.adjuntados);

        } catch (error: any) {
            await message.reply(error.message);
        }
    }
  }
}