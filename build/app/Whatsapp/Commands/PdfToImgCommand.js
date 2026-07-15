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
const tmp_1 = __importDefault(require("tmp"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const PDFServicesSdk = __importStar(require("@adobe/pdfservices-node-sdk"));
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class PdfToImgCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!pdf2img [zip] (Responda a un PDF) - Convierte el PDF a imágenes (individuales o archivadas).';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!pdf2img')
            return;
        const clientId = Env_1.default.get('ADOBE_CLIENT_ID');
        const clientSecret = Env_1.default.get('ADOBE_CLIENT_SECRET');
        if (!clientId || !clientSecret) {
            await message.reply('Error del sistema: Las credenciales de Adobe PDF no están configuradas.');
            return;
        }
        if (!message.hasQuotedMsg) {
            await message.reply('Por favor, cite un archivo PDF.');
            return;
        }
        const media = await (0, QuotedMessage_1.downloadQuotedMediaSafely)(message, 'PdfToImgCommand');
        if (!media || media.mimetype !== 'application/pdf') {
            await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.');
            return;
        }
        const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
            .withClientId(clientId)
            .withClientSecret(clientSecret)
            .build();
        const executionContext = PDFServicesSdk.ExecutionContext.create(credentials);
        await new Promise((resolve) => {
            tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                if (err) {
                    await message.reply('Ocurrió un error al preparar el entorno de procesamiento.');
                    return resolve();
                }
                try {
                    const inputPath = path_1.default.join(dirPath, 'input.pdf');
                    await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                    let exportPDFToImagesOperation = PDFServicesSdk.ExportPDFToImages.Operation.createNew(PDFServicesSdk.ExportPDFToImages.SupportedTargetFormats.JPEG);
                    const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath);
                    exportPDFToImagesOperation.setInput(input);
                    const inlineText = body.replace(cmd, '').trim();
                    const isZip = inlineText.toLowerCase() === 'zip';
                    if (isZip) {
                        exportPDFToImagesOperation.setOutputType(PDFServicesSdk.ExportPDFToImages.OutputType.ZIP_OF_PAGE_IMAGES);
                    }
                    const result = await exportPDFToImagesOperation.execute(executionContext);
                    if (isZip) {
                        const outputPath = path_1.default.join(dirPath, 'export.zip');
                        await result[0].saveAsFile(outputPath);
                        const zipMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                        await message.reply(zipMessage);
                    }
                    else {
                        let filesPromises = [];
                        for (let i = 0; i < result.length; i++) {
                            const outputPath = path_1.default.join(dirPath, `export_${i}.jpeg`);
                            filesPromises.push(result[i].saveAsFile(outputPath).then(() => outputPath));
                        }
                        const outputPaths = await Promise.all(filesPromises);
                        for (const outputPath of outputPaths) {
                            const imageMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                            await message.reply(imageMessage);
                        }
                    }
                }
                catch (error) {
                    console.error('Exception encountered while executing operation', error);
                    await message.reply('Ocurrió un error al convertir el archivo PDF a imágenes. Por favor, intente nuevamente.');
                }
                finally {
                    cleanupCallback();
                    resolve();
                }
            });
        });
    }
}
exports.default = PdfToImgCommand;
//# sourceMappingURL=PdfToImgCommand.js.map