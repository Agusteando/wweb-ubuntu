import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { getGoogleAdminAuth } from '../../Services/Utils'
import { google } from 'googleapis'

export default class DpCommand {
  public type = 'Command'
  public instructions = '!dp <search_term> - Searches user and sets selection mode. Send a number to select.'

  async handle(message: Message, client: Client, session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (session.waiting && session.cmd === 'DP_SELECTION' && !isNaN(Number(body.trim()))) {
        const index = parseInt(body.trim()) - 1
        if (session.remember && session.remember[index]) {
            const user = session.remember[index]
            await message.reply(`Seleccionaste a ${user.name.fullName}.`)
            session.waiting = false
            session.cmd = null
            session.remember = null
        }
        return
    }

    if (cmd === '!dp') {
        try {
            const jwtClient = await getGoogleAdminAuth(['https://www.googleapis.com/auth/admin.directory.user.readonly']);
            const service = google.admin({ version: 'directory_v1', auth: jwtClient });

            const searchTerm = body.replace(cmd, "").trim().toLowerCase();
            const res = await service.users.list({
                domain: 'casitaiedis.edu.mx',
                query: `${searchTerm}`,
                maxResults: 30,
                orderBy: 'email'
            });

            const users = res.data.users;
            if (!users || users.length === 0) {
                message.reply('No se encontraron usuarios.');
                return;
            }

            let userListMessage = '*Usuarios encontrados:* Seleccione un número para interactuar.\n';
            users.forEach((user, index) => {
                userListMessage += `${index + 1}. ${user.name.fullName} - ${user.primaryEmail}\n`;
            });

            await message.reply(userListMessage);

            setTimeout(() => {
                session.waiting = true;
                session.remember = users;
                session.cmd = 'DP_SELECTION';
            }, 500);

        } catch (error) {
            message.reply("Hubo un error al buscar el usuario.");
        }
    }
  }
}