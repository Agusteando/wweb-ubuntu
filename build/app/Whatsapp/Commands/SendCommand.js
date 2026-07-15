"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class SendCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!send <to: email> <subject: text> - Sends email with attached media if quoted';
    }
    async handle(message, _client, session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd === '!send' || cmd === '!email') {
            try {
                if (!session.adjuntados)
                    session.adjuntados = [];
                console.log("Before !send, adjuntados:", session.adjuntados);
                var argumentos = body.replace(new RegExp(`^${cmd}`, 'i'), "").replace('🐺', '').trim().split(/\s(?=\w+:)/)
                    .reduce((acc, el) => {
                    const [key, value] = el.split(/:(.+)/);
                    if (key && value) {
                        acc[key.trim()] = value.trim();
                    }
                    return acc;
                }, {});
                if (message.hasQuotedMsg) {
                    var quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'SendCommand');
                    if (!quotedMsg) {
                        await message.reply('No fue posible recuperar el mensaje citado. Vuelva a citar el mensaje e inténtelo nuevamente.');
                        return;
                    }
                    const bodyText = quotedMsg.body || '';
                    argumentos.message = bodyText.replace(/\n/g, "<br>");
                    if (quotedMsg.hasMedia) {
                        const media = await (0, QuotedMessage_1.downloadQuotedMediaSafely)(message, 'SendCommand');
                        if (!media) {
                            await message.reply('No fue posible descargar el archivo citado.');
                            return;
                        }
                        session.adjuntados.push(media);
                        await message.reply("Archivo adjuntado exitosamente");
                    }
                    argumentos.files = session.adjuntados;
                }
                else {
                    argumentos.files = session.adjuntados;
                }
                var result = await (0, Utils_1.sendEmail)(argumentos);
                console.log('Result from sendEmail:', result);
                if (result && result.status == 200) {
                    await message.reply("Correo enviado a *" + (argumentos.to || 'aguswubslyn@gmail.com') + "* ✅");
                    session.adjuntados = [];
                }
                else {
                    await message.reply("Error al enviar correo: " + JSON.stringify(result));
                }
                console.log("After !send, adjuntados:", session.adjuntados);
            }
            catch (error) {
                await message.reply(error.message);
            }
        }
    }
}
exports.default = SendCommand;
//# sourceMappingURL=SendCommand.js.map