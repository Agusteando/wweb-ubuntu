"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const googleapis_1 = require("googleapis");
const fs_1 = require("fs");
const tmp_1 = __importDefault(require("tmp"));
class DpCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!dp <search_term> - Searches user and sets selection mode to fetch their profile picture.';
    }
    async handle(message, _client, session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
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
                const jwtClient = await (0, Utils_1.getGoogleAdminAuth)(['https://www.googleapis.com/auth/admin.directory.user.readonly']);
                const service = googleapis_1.google.admin({ version: 'directory_v1', auth: jwtClient });
                const userPhotoResponse = await service.users.photos.get({
                    userKey: selectedUser.primaryEmail,
                });
                if (userPhotoResponse.data.photoData) {
                    const photoBase64 = userPhotoResponse.data.photoData;
                    const tmpFile = tmp_1.default.fileSync({ postfix: '.jpg' });
                    await fs_1.promises.writeFile(tmpFile.name, Buffer.from(photoBase64, 'base64'));
                    const { MessageMedia } = await Promise.resolve().then(() => __importStar(require('whatsapp-web.js')));
                    const mediaMessage = MessageMedia.fromFilePath(tmpFile.name);
                    await message.reply(mediaMessage);
                    tmpFile.removeCallback();
                }
                else {
                    await message.reply("No se encontró imagen de perfil para el usuario seleccionado.");
                }
                session.cmd = null;
                session.remember = null;
                session.waiting = false;
            }
            catch (error) {
                console.error('Error fetching profile picture:', error);
                await message.reply("Hubo un error al obtener la imagen de perfil.");
            }
            return;
        }
        if (cmd === '!dp') {
            try {
                const jwtClient = await (0, Utils_1.getGoogleAdminAuth)(['https://www.googleapis.com/auth/admin.directory.user.readonly']);
                const service = googleapis_1.google.admin({ version: 'directory_v1', auth: jwtClient });
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
            }
            catch (error) {
                await message.reply("Hubo un error al buscar el usuario.");
            }
        }
    }
}
exports.default = DpCommand;
//# sourceMappingURL=DpCommand.js.map