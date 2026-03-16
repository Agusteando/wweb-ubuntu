import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import Env from '@ioc:Adonis/Core/Env'
import tmp from 'tmp'
import * as PDFServicesSdk from '@adobe/pdfservices-node-sdk'

export default class PdfCommand {
  public type = 'Command'
  public instructions = '!pdf2word (Reply to PDF) | !word2pdf (Reply to Word)'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!pdf2word' && cmd !== '!pdf2doc' && cmd !== '!word2pdf' && cmd !== '!doc2pdf') {
        return
    }

    const clientId = Env.get('ADOBE_CLIENT_ID')
    const clientSecret = Env.get('ADOBE_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
        await message.reply('⚠️ Error de sistema: Las credenciales de Adobe PDF no están configuradas en este servidor.')
        return
    }

    const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
        .withClientId(clientId)
        .withClientSecret(clientSecret)
        .build()
        
    const executionContext = PDFServicesSdk.ExecutionContext.create(credentials)

    if (cmd === '!pdf2word' || cmd === '!pdf2doc') {
        if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (quotedMsg.hasMedia) {
                const media = await quotedMsg.downloadMedia();
                if (!media) {
                    await message.reply('No se pudo descargar el archivo.');
                    return;
                }
                const mimeType = media.mimetype;
                
                if (mimeType === 'application/pdf') {
                    // Wrapped safely in a promise to handle tmp directories cleanly
                    await new Promise<void>((resolve) => {
                        tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                            if (err) {
                                await message.reply('Ocurrió un error al preparar el sistema de archivos.');
                                return resolve();
                            }

                            try {
                                const inputPath = path.join(dirPath, 'input.pdf');
                                const outputPath = path.join(dirPath, `${Date.now()}.docx`);

                                await fs.writeFile(inputPath, media.data, 'base64');

                                const exportPdfOperation = PDFServicesSdk.ExportPDF.Operation.createNew(PDFServicesSdk.ExportPDF.SupportedTargetFormats.DOCX);
                                const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath);
                                exportPdfOperation.setInput(input);

                                const result = await exportPdfOperation.execute(executionContext);
                                await result.saveAsFile(outputPath);

                                const wordMessage = await MessageMedia.fromFilePath(outputPath);
                                await message.reply(wordMessage);
                            } catch (error) {
                                console.log('Exception encountered while executing operation', error);
                                await message.reply('Ocurrió un error al convertir el documento. Por favor, inténtalo de nuevo.');
                            } finally {
                                cleanupCallback();
                                resolve();
                            }
                        });
                    });
                } else {
                    await message.reply('¿Un archivo que no es PDF? 😅 Por favor, utiliza un archivo PDF para convertir a Word. El comando correcto es `!pdf2word`. 😉');
                }
            } else {
                await message.reply('Por favor, cita un archivo PDF.');
            }
        } else {
            await message.reply('Por favor, cita un archivo PDF.');
        }
    } 
    
    else if (cmd === '!word2pdf' || cmd === '!doc2pdf') {
        if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (quotedMsg.hasMedia) {
                const media = await quotedMsg.downloadMedia();
                if (!media) {
                    await message.reply('No se pudo descargar el archivo.');
                    return;
                }
                const mimeType = media.mimetype;
                
                if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    await new Promise<void>((resolve) => {
                        tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                            if (err) {
                                await message.reply('Ocurrió un error al preparar el sistema de archivos.');
                                return resolve();
                            }

                            try {
                                const inputPath = path.join(dirPath, 'input.docx');
                                const outputFilename = media.filename ? media.filename.replace(/\.[^/.]+$/, ".pdf") : `${Date.now()}.pdf`;
                                const outputPath = path.join(dirPath, outputFilename);

                                await fs.writeFile(inputPath, media.data, 'base64');

                                const createPdfOperation = PDFServicesSdk.CreatePDF.Operation.createNew();
                                const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath, PDFServicesSdk.CreatePDF.SupportedSourceFormat.docx);
                                createPdfOperation.setInput(input);

                                const result = await createPdfOperation.execute(executionContext);
                                await result.saveAsFile(outputPath);

                                const pdfMessage = await MessageMedia.fromFilePath(outputPath);
                                await message.reply(pdfMessage);
                            } catch (error) {
                                console.log('Exception encountered while executing operation', error);
                                await message.reply('Ocurrió un error al convertir el documento. Por favor, inténtalo de nuevo.');
                            } finally {
                                cleanupCallback();
                                resolve();
                            }
                        });
                    });
                } else {
                    await message.reply('Hmm, parece que este archivo no es de Word. 😅 Por favor, envía un documento de Word para convertir a PDF. El comando correcto es `!word2pdf`. 😉');
                }
            } else {
                await message.reply('Por favor, cita un documento de Word.');
            }
        } else {
            await message.reply('Por favor, cita un documento de Word.');
        }
    }
  }
}