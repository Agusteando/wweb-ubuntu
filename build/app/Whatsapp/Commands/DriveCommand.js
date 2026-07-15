"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const googleapis_1 = require("googleapis");
const stream_1 = require("stream");
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class DriveCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!drive ? - Gestión avanzada e intuitiva de Google Drive.';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        if (!body.toLowerCase().startsWith('!drive'))
            return;
        const args = body.split(' ').filter(arg => arg.trim() !== '');
        const action = args[1]?.toLowerCase();
        if (!action || action === '?' || action === 'help') {
            let helpText = "☁️ *Gestor de Google Drive*\n\n" +
                "Uso correcto de comandos:\n\n" +
                "1️⃣ *Hacer Público*\n" +
                "   `!drive set <correo>:<fileId>`\n" +
                "2️⃣ *Permisos y Propietario*\n" +
                "   `!drive user <role> <tu_correo>:<fileId>:<correo_destino>`\n" +
                "   _(Roles My Drive: viewer, commenter, editor, owner)_\n" +
                "   _(Roles Shared Drive: organizer, fileorganizer)_\n" +
                "3️⃣ *Listar Archivos*\n" +
                "   `!drive list <correo>:<folderId>`\n" +
                "4️⃣ *Descargar Archivo*\n" +
                "   `!drive file <correo>:<fileId>`\n" +
                "5️⃣ *Subir Archivo* (Citando un mensaje)\n" +
                "   `!drive upload <correo>:<folderId>`\n\n" +
                "💡 *Tip:* El `<correo>` debe ser una cuenta autenticada válida en tu Workspace.";
            await message.reply(helpText);
            return;
        }
        try {
            const getDriveClient = async (userEmail) => {
                if (!userEmail || !userEmail.includes("@")) {
                    throw new Error("El formato de usuario es incorrecto. Debe ser un correo electrónico válido.");
                }
                const jwtClient = await (0, Utils_1.getGoogleAdminAuth)(['https://www.googleapis.com/auth/drive'], userEmail.trim());
                return googleapis_1.google.drive({ version: "v3", auth: jwtClient });
            };
            if (action === "set" || action === "public") {
                const details = args[2];
                if (!details || !details.includes(':'))
                    return message.reply("⚠️ Uso correcto: `!drive set <correo>:<id>`");
                const [user, ...idParts] = details.split(":");
                const id = idParts.join(":").trim();
                const drive = await getDriveClient(user);
                await drive.permissions.create({
                    fileId: id,
                    supportsAllDrives: true,
                    requestBody: {
                        role: "reader",
                        type: "anyone"
                    }
                });
                await message.reply(`✅ El archivo/carpeta con ID \`${id}\` ahora es *Público* (Cualquiera con el enlace puede leerlo).`);
                return;
            }
            if (action === "user" || action === "perm") {
                const roleInput = args[2]?.toLowerCase();
                const details = args[3];
                if (!roleInput || !details || !details.includes(':')) {
                    return message.reply("⚠️ Uso correcto: `!drive user <role> <tu_correo>:<fileId>:<correo_destino>`");
                }
                const allowedRoles = ["viewer", "commenter", "editor", "owner", "organizer", "fileorganizer"];
                if (!allowedRoles.includes(roleInput)) {
                    return message.reply("⚠️ Roles válidos: `viewer | commenter | editor | owner | organizer | fileorganizer`");
                }
                const parts = details.split(":");
                if (parts.length < 3)
                    return message.reply("⚠️ Formato de detalles incorrecto. Usa: `<tu_correo>:<fileId>:<correo_destino>`");
                const authUser = parts[0];
                const targetEmail = parts.pop();
                const id = parts.slice(1).join(":");
                if (!authUser || !authUser.includes("@"))
                    return message.reply("❌ El usuario autenticado original es inválido.");
                if (!id)
                    return message.reply("❌ Debes proporcionar el ID del archivo o carpeta.");
                if (!targetEmail || !targetEmail.includes("@"))
                    return message.reply("❌ Correo de destino inválido.");
                const roleMap = {
                    viewer: "reader",
                    commenter: "commenter",
                    editor: "writer",
                    owner: "owner",
                    organizer: "organizer",
                    fileorganizer: "fileOrganizer"
                };
                const drive = await getDriveClient(authUser);
                const fileInfo = await drive.files.get({
                    fileId: id,
                    fields: "driveId, parents",
                    supportsAllDrives: true
                });
                const isSharedDrive = !!fileInfo.data.driveId;
                if (isSharedDrive && roleInput === "owner") {
                    return message.reply("🛑 *Acción Denegada por Google:*\n" +
                        "Los elementos en una Unidad Compartida (Shared Drive) pertenecen a la organización, no a un usuario individual. No puedes asignar el rol `owner`.\n\n" +
                        "👉 *Soluciones:*\n" +
                        "• Si es un archivo, asígnale el rol `editor`.\n" +
                        "• Si es una carpeta, asígnale el rol `fileorganizer` o `organizer`.\n" +
                        "• Si necesitas transferir la propiedad a un individuo, debes mover el archivo a tu unidad personal ('Mi Unidad') primero.");
                }
                const isTransfer = roleInput === "owner";
                await drive.permissions.create({
                    fileId: id,
                    supportsAllDrives: true,
                    transferOwnership: isTransfer,
                    requestBody: {
                        type: "user",
                        role: roleMap[roleInput],
                        emailAddress: targetEmail.trim()
                    }
                });
                await message.reply(`✅ Permisos actualizados exitosamente.\n\n` +
                    `*Rol asignado:* ${roleInput.toUpperCase()}\n` +
                    `*Usuario Beneficiado:* ${targetEmail}\n` +
                    `*ID Afectado:* \`${id}\`\n` +
                    `*Ubicación:* ${isSharedDrive ? 'Unidad Compartida 🏢' : 'Mi Unidad 👤'}`);
                return;
            }
            if (action === "list") {
                const details = args[2];
                if (!details || !details.includes(':'))
                    return message.reply("⚠️ Uso correcto: `!drive list <correo>:<folderid>`");
                const [user, ...folderParts] = details.split(":");
                const folderId = folderParts.join(":").trim();
                const drive = await getDriveClient(user);
                const res = await drive.files.list({
                    q: `'${folderId}' in parents and trashed = false`,
                    fields: "files(id, name, webViewLink, mimeType)",
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true
                });
                if (!res.data.files || !res.data.files.length) {
                    return message.reply("📭 No se encontraron archivos en la carpeta especificada.");
                }
                let text = `📂 *Directorio / Archivos Encontrados:*\n\n`;
                res.data.files.forEach((f) => {
                    const icon = f.mimeType?.includes('folder') ? '📁' : '📄';
                    text += `${icon} *${f.name}*\n↳ ID: \`${f.id}\`\n↳ [Abrir Vínculo](${f.webViewLink})\n\n`;
                });
                await message.reply(text.trim());
                return;
            }
            if (action === "file" || action === "download") {
                const details = args[2];
                if (!details || !details.includes(':'))
                    return message.reply("⚠️ Uso correcto: `!drive file <correo>:<fileId>`");
                const [user, ...idParts] = details.split(":");
                const id = idParts.join(":").trim();
                const drive = await getDriveClient(user);
                await message.reply('⏳ Analizando y descargando archivo desde Google Drive...');
                const nameRes = await drive.files.get({
                    fileId: id,
                    fields: "name, mimeType",
                    supportsAllDrives: true
                });
                let arrayBufferData;
                try {
                    const fileRes = await drive.files.get({ fileId: id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
                    arrayBufferData = fileRes.data;
                }
                catch (dlError) {
                    if (nameRes.data.mimeType && nameRes.data.mimeType.includes('application/vnd.google-apps')) {
                        const exportRes = await drive.files.export({ fileId: id, mimeType: 'application/pdf' }, { responseType: "arraybuffer" });
                        arrayBufferData = exportRes.data;
                        nameRes.data.mimeType = 'application/pdf';
                        nameRes.data.name = `${nameRes.data.name}.pdf`;
                    }
                    else {
                        throw dlError;
                    }
                }
                const base64Data = Buffer.from(arrayBufferData).toString("base64");
                const mediaMessage = new whatsapp_web_js_1.MessageMedia(nameRes.data.mimeType || "application/octet-stream", base64Data, nameRes.data.name || "descargado_de_drive");
                await message.reply(mediaMessage);
                return;
            }
            if (action === "upload") {
                const details = args[2];
                if (!details || !details.includes(':'))
                    return message.reply("⚠️ Uso correcto: `!drive upload <correo>:<folderid>`");
                const [user, ...folderParts] = details.split(":");
                const folderId = folderParts.join(":").trim() || "root";
                const drive = await getDriveClient(user);
                if (!message.hasQuotedMsg) {
                    return message.reply("⚠️ *Requisito:* Debes citar un mensaje tuyo o de otro usuario que contenga un archivo adjunto para usar este comando.");
                }
                const quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'DriveCommand');
                if (!quotedMsg || !quotedMsg.hasMedia) {
                    return message.reply("⚠️ El mensaje citado no contiene ningún archivo físico o multimedia detectado.");
                }
                await message.reply('⏳ Transfiriendo archivo citado a la nube de Google Drive...');
                const media = await quotedMsg.downloadMedia();
                if (!media)
                    return message.reply("❌ Ocurrió un error al descargar el archivo encriptado desde WhatsApp.");
                const buffer = Buffer.from(media.data, "base64");
                const stream = stream_1.Readable.from(buffer);
                const fileMetadata = {
                    name: media.filename || `transferencia_wa_${Date.now()}.${media.mimetype.split('/')[1] || 'bin'}`,
                    parents: [folderId]
                };
                const mediaData = {
                    mimeType: media.mimetype,
                    body: stream
                };
                const uploaded = await drive.files.create({
                    requestBody: fileMetadata,
                    media: mediaData,
                    fields: "id, name, webViewLink",
                    supportsAllDrives: true
                });
                await message.reply(`✅ *Carga Terminada con Éxito*\n\n` +
                    `*Nombre:* ${uploaded.data.name}\n` +
                    `*ID Asignado:* \`${uploaded.data.id}\`\n` +
                    `*URL Privada:* [Abrir en Drive](${uploaded.data.webViewLink})`);
                return;
            }
            await message.reply("⚠️ Subcomando no reconocido. Envía `!drive ?` para abrir el asistente de ayuda.");
        }
        catch (error) {
            console.error("Error handling Google Drive command:", error);
            await message.reply(`❌ Hubo un error de ejecución en la API de Google Drive:\n_${error.message}_`);
        }
    }
}
exports.default = DriveCommand;
//# sourceMappingURL=DriveCommand.js.map