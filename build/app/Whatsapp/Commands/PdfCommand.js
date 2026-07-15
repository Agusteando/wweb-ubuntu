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
const whatsapp_web_js_1 = require("whatsapp-web.js");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const tmp_1 = __importDefault(require("tmp"));
const PDFServicesSdk = __importStar(require("@adobe/pdfservices-node-sdk"));
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class PdfCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!pdf2word (Reply to PDF) | !word2pdf (Reply to Word)';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!pdf2word' && cmd !== '!pdf2doc' && cmd !== '!word2pdf' && cmd !== '!doc2pdf') {
            return;
        }
        const clientId = Env_1.default.get('ADOBE_CLIENT_ID');
        const clientSecret = Env_1.default.get('ADOBE_CLIENT_SECRET');
        if (!clientId || !clientSecret) {
            await message.reply('⚠️ Error de sistema: Las credenciales de Adobe PDF no están configuradas en este servidor.');
            return;
        }
        const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
            .withClientId(clientId)
            .withClientSecret(clientSecret)
            .build();
        const executionContext = PDFServicesSdk.ExecutionContext.create(credentials);
        if (cmd === '!pdf2word' || cmd === '!pdf2doc') {
            if (message.hasQuotedMsg) {
                const quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'PdfCommand');
                if (quotedMsg && quotedMsg.hasMedia) {
                    const media = await quotedMsg.downloadMedia();
                    if (!media) {
                        await message.reply('No se pudo descargar el archivo.');
                        return;
                    }
                    const mimeType = media.mimetype;
                    if (mimeType === 'application/pdf') {
                        await new Promise((resolve) => {
                            tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                                if (err) {
                                    await message.reply('Ocurrió un error al preparar el sistema de archivos.');
                                    return resolve();
                                }
                                try {
                                    const inputPath = path_1.default.join(dirPath, 'input.pdf');
                                    const outputPath = path_1.default.join(dirPath, `${Date.now()}.docx`);
                                    await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                                    const exportPdfOperation = PDFServicesSdk.ExportPDF.Operation.createNew(PDFServicesSdk.ExportPDF.SupportedTargetFormats.DOCX);
                                    const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath);
                                    exportPdfOperation.setInput(input);
                                    const result = await exportPdfOperation.execute(executionContext);
                                    await result.saveAsFile(outputPath);
                                    const wordMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                                    await message.reply(wordMessage);
                                }
                                catch (error) {
                                    console.log('Exception encountered while executing operation', error);
                                    await message.reply('Ocurrió un error al convertir el documento. Por favor, inténtalo de nuevo.');
                                }
                                finally {
                                    cleanupCallback();
                                    resolve();
                                }
                            });
                        });
                    }
                    else {
                        await message.reply('¿Un archivo que no es PDF? 😅 Por favor, utiliza un archivo PDF para convertir a Word. El comando correcto es `!pdf2word`. 😉');
                    }
                }
                else {
                    await message.reply('Por favor, cita un archivo PDF.');
                }
            }
            else {
                await message.reply('Por favor, cita un archivo PDF.');
            }
        }
        else if (cmd === '!word2pdf' || cmd === '!doc2pdf') {
            if (message.hasQuotedMsg) {
                const quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'PdfCommand');
                if (quotedMsg && quotedMsg.hasMedia) {
                    const media = await quotedMsg.downloadMedia();
                    if (!media) {
                        await message.reply('No se pudo descargar el archivo.');
                        return;
                    }
                    const mimeType = media.mimetype;
                    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        await new Promise((resolve) => {
                            tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                                if (err) {
                                    await message.reply('Ocurrió un error al preparar el sistema de archivos.');
                                    return resolve();
                                }
                                try {
                                    const inputPath = path_1.default.join(dirPath, 'input.docx');
                                    const outputFilename = media.filename ? media.filename.replace(/\.[^/.]+$/, ".pdf") : `${Date.now()}.pdf`;
                                    const outputPath = path_1.default.join(dirPath, outputFilename);
                                    await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                                    const createPdfOperation = PDFServicesSdk.CreatePDF.Operation.createNew();
                                    const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath, PDFServicesSdk.CreatePDF.SupportedSourceFormat.docx);
                                    createPdfOperation.setInput(input);
                                    const result = await createPdfOperation.execute(executionContext);
                                    await result.saveAsFile(outputPath);
                                    const pdfMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                                    await message.reply(pdfMessage);
                                }
                                catch (error) {
                                    console.log('Exception encountered while executing operation', error);
                                    await message.reply('Ocurrió un error al convertir el documento. Por favor, inténtalo de nuevo.');
                                }
                                finally {
                                    cleanupCallback();
                                    resolve();
                                }
                            });
                        });
                    }
                    else {
                        await message.reply('Hmm, parece que este archivo no es de Word. 😅 Por favor, envía un documento de Word para convertir a PDF. El comando correcto es `!word2pdf`. 😉');
                    }
                }
                else {
                    await message.reply('Por favor, cita un documento de Word.');
                }
            }
            else {
                await message.reply('Por favor, cita un documento de Word.');
            }
        }
    }
}
exports.default = PdfCommand;
//# sourceMappingURL=PdfCommand.js.map