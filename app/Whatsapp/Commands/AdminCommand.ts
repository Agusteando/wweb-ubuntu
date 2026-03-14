import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { getGoogleAdminAuth } from '../../Services/Utils'
import { google } from 'googleapis'

export default class AdminCommand {
  public type = 'Command'
  public instructions = '!admin <search> | !admin username <email> <first>, <last> | !admin password <email>'

  async handle(message: Message, client: Client, session: UserSession) {
    const body = message.body || ''
    if (!body.startsWith('!admin')) return

    const args = body.split(' ')
    const cmd = args[0]
    
    try {
        const jwtClient = await getGoogleAdminAuth(['https://www.googleapis.com/auth/admin.directory.user']);
        const service = google.admin({ version: 'directory_v1', auth: jwtClient });

        const action = args[1]?.toLowerCase();
        const email = args[2];
        const newNameOrPassword = args.slice(3).join(' ');

        if (action === "username" && email && newNameOrPassword) {
            const [firstName, lastName] = newNameOrPassword.split(',').map(name => name.trim());
            await service.users.update({
                userKey: email,
                requestBody: { name: { givenName: firstName || '', familyName: lastName || '' } }
            });
            message.reply(`El nombre del usuario ha sido cambiado a: ${firstName} ${lastName}`);
        } else if (action === "password" && email) {
            const newPassword = Math.random().toString(36).slice(-8);
            await service.users.update({
                userKey: email,
                requestBody: { password: newPassword }
            });
            message.reply(`La contraseña del usuario ha sido reseteada a: ${newPassword}`);
        } else {
            const searchTerm = body.replace(cmd, "").trim().toLowerCase();
            const res = await service.users.list({
                domain: 'casitaiedis.edu.mx',
                query: `${searchTerm}`,
                maxResults: 30,
                orderBy: 'email'
            });

            const users = res.data.users;
            if (users && users.length) {
                let replyMessage = '*Usuarios encontrados:*\n';
                users.forEach((user, index) => {
                    replyMessage += `${index + 1}. ${user.name.fullName} - ${user.primaryEmail}\n`;
                });
                message.reply(replyMessage);
            } else {
                message.reply('No se encontraron usuarios.');
            }
        }
    } catch (error) {
        message.reply('Error al ejecutar el comando !admin: ' + error.message);
    }
  }
}