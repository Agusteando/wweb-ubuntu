"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const googleapis_1 = require("googleapis");
class AdminCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!admin <search> | !admin username <email> <first>, <last> | !admin password <email>';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        if (!body.startsWith('!admin'))
            return;
        const args = body.split(' ');
        const cmd = args[0];
        try {
            const jwtClient = await (0, Utils_1.getGoogleAdminAuth)(['https://www.googleapis.com/auth/admin.directory.user']);
            const service = googleapis_1.google.admin({ version: 'directory_v1', auth: jwtClient });
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
            }
            else if (action === "password" && email) {
                const newPassword = Math.random().toString(36).slice(-8);
                await service.users.update({
                    userKey: email,
                    requestBody: { password: newPassword }
                });
                message.reply(`La contraseña del usuario ha sido reseteada a: ${newPassword}`);
            }
            else {
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
                        const fullName = user.name?.fullName || 'Desconocido';
                        const primaryEmail = user.primaryEmail || 'Sin email';
                        replyMessage += `${index + 1}. ${fullName} - ${primaryEmail}\n`;
                    });
                    message.reply(replyMessage);
                }
                else {
                    message.reply('No se encontraron usuarios.');
                }
            }
        }
        catch (error) {
            message.reply('Error al ejecutar el comando !admin: ' + error.message);
        }
    }
}
exports.default = AdminCommand;
//# sourceMappingURL=AdminCommand.js.map