import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { getGoogleAdminAuth } from 'App/Services/Utils'
import { google } from 'googleapis'
import fs from 'fs'
import Application from '@ioc:Adonis/Core/Application'

export default class UploadDriveCommand {
  public type = 'Command'
  public instructions = '!upload-drive [folderName] - Responde a un mensaje con archivo para subir a Drive'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    if (!body.startsWith('!upload-drive')) return

    const args = body.split(' ')
    const folderName = args.length > 1 ? args[1] : null;

    try {
        const jwtClient = await getGoogleAdminAuth(['https://www.googleapis.com/auth/drive'])
        const drive = google.drive({ version: 'v3', auth: jwtClient });

        if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (quotedMsg.hasMedia) {
                const media = await quotedMsg.downloadMedia();

                if (media) {
                    const extension = media.mimetype.split('/')[1] || 'bin';
                    const filename = `${Date.now()}-${media.filename || 'file'}.${extension}`;
                    const filePath = Application.tmpPath(filename);
                    
                    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

                    let folderId = '1Xf5ogZbfasbXkb62vynPkFEPjGqRU26F';

                    if (folderName) {
                        const folderRes = await drive.files.list({
                            q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '${folderName}'`,
                            fields: 'files(id, name)'
                        });

                        const files = folderRes.data.files || [];

                        if (files.length > 0 && files[0].id) {
                            folderId = files[0].id;
                        } else {
                            const createFolderRes = await drive.files.create({
                                requestBody: {
                                    name: folderName,
                                    parents: [folderId],
                                    mimeType: 'application/vnd.google-apps.folder'
                                },
                                fields: 'id'
                            });
                            if (createFolderRes.data.id) {
                                folderId = createFolderRes.data.id;
                            }
                        }
                    }

                    let mediaMimeType = media.mimetype;
                    let convertedMimeType;

                    const isExcel = mediaMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                        mediaMimeType === 'application/vnd.ms-excel';
                    const isWord = mediaMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                        mediaMimeType === 'application/msword';

                    if (isExcel) convertedMimeType = 'application/vnd.google-apps.spreadsheet';
                    else if (isWord) convertedMimeType = 'application/vnd.google-apps.document';

                    const fileMetadata = {
                        name: filename,
                        parents: [folderId],
                        mimeType: convertedMimeType || mediaMimeType
                    };

                    const mediaBody = {
                        mimeType: mediaMimeType,
                        body: fs.createReadStream(filePath)
                    };

                    const fileRes = await drive.files.create({
                        requestBody: fileMetadata,
                        media: mediaBody,
                        fields: 'id, webViewLink'
                    });

                    const fileId = fileRes.data.id || 'unknown';
                    const fileLink = fileRes.data.webViewLink || 'unknown';

                    fs.unlinkSync(filePath);

                    await message.reply(`📤 *File Uploaded Successfully!* 📤\n\n*File ID:* ${fileId}\n*Link:* ${fileLink}`);
                } else {
                    await message.reply('⚠️ *Error:* Failed to download the media.');
                }
            } else {
                await message.reply('⚠️ *Error:* The quoted message does not contain media.');
            }
        } else {
            await message.reply('⚠️ *Error:* Please quote a message that contains the media you want to upload.');
        }
    } catch (error: any) {
        await message.reply(`❌ *Error executing !upload-drive command:* ${error.message}`);
    }
  }
}