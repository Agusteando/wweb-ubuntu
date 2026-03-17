import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { getGoogleAdminAuth } from 'App/Services/Utils'
import { google } from 'googleapis'
import { promises as fs } from 'fs'
import tmp from 'tmp'

export default class DpCommand {
  public type = 'Command'
  public instructions = '!dp <search_term> - Searches user and sets selection mode to fetch their profile picture.'

  async handle(message: Message, _client: Client, session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (session.waiting && session.cmd === 'DP_SELECTION') {
        const numberPattern = /\d+/g;
        const match = body.match(numberPattern);
        const index = match ? parseInt(match[0], 10) - 1 : undefined;

        if (index === undefined || index < 0 || index >= (session.remember?.length || 0)) {
            await message.reply("Selección inválida. Por favor, intente nuevamente.");
            return;
        }

        const selectedUser = session.remember[index];

        try {
            const jwtClient = await getGoogleAdminAuth(['https://www.googleapis.com/auth/admin.directory.user.readonly']);
            const service = google.admin({ version: 'directory_v1', auth: jwtClient });

            const userPhotoResponse = await service.users.photos.get({
                userKey: selectedUser.primaryEmail,
            });

            if (userPhotoResponse.data.photoData) {
                const photoBase64 = userPhotoResponse.data.photoData;

                const tmpFile = tmp.fileSync({ postfix: '.jpg' });
                await fs.writeFile(tmpFile.name, Buffer.from(photoBase64, 'base64'));

                const { MessageMedia } = await import('whatsapp-web.js');
                const mediaMessage = MessageMedia.fromFilePath(tmpFile.name);
                await message.reply(mediaMessage);

                tmpFile.removeCallback();
            } else {
                await message.reply("No se encontró imagen de perfil para el usuario seleccionado.");
            }

            session.cmd = null;
            session.remember = null;
            session.waiting = false;

        } catch (error) {
            console.error('Error fetching profile picture:', error);
            await message.reply("Hubo un error al obtener la imagen de perfil.");
        }
        return;
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
                await message.reply('No se encontraron usuarios.');
                return;
            }

            let userListMessage = '*Usuarios encontrados:* Seleccione un número para interactuar.\n';
            users.forEach((user, index) => {
                const fullName = user.name?.fullName || 'Desconocido';
                const primaryEmail = user.primaryEmail || 'Sin email';
                userListMessage += `${index + 1}. ${fullName} - ${primaryEmail}\n`;
            });

            await message.reply(userListMessage);

            setTimeout(() => {
                session.waiting = true;
                session.remember = users;
                session.cmd = 'DP_SELECTION';
            }, 500);

        } catch (error: any) {
            await message.reply("Hubo un error al buscar el usuario.");
        }
    }
  }
}