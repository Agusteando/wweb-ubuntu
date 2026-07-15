"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const tmp_1 = __importDefault(require("tmp"));
const pdf_lib_1 = require("pdf-lib");
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
class ImgToPdfCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!img2pdf (Responda a una imagen) - Convierte la imagen proporcionada a formato PDF.';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!img2pdf')
            return;
        if (!message.hasQuotedMsg) {
            await message.reply('Por favor, cite un archivo de imagen.');
            return;
        }
        const quotedMsg = await (0, QuotedMessage_1.getQuotedMessageSafely)(message, 'ImgToPdfCommand');
        if (!quotedMsg || !quotedMsg.hasMedia) {
            await message.reply('Por favor, cite un archivo de imagen.');
            return;
        }
        const media = await quotedMsg.downloadMedia();
        if (!media || !media.mimetype.startsWith('image/')) {
            await message.reply('Formato de archivo no soportado. Por favor, cite una imagen válida.');
            return;
        }
        await new Promise((resolve) => {
            tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                if (err) {
                    await message.reply('Ocurrió un error al preparar el entorno de procesamiento.');
                    return resolve();
                }
                try {
                    const inputPath = path_1.default.join(dirPath, 'input_image');
                    await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                    const pdfDoc = await pdf_lib_1.PDFDocument.create();
                    let image;
                    const imgBytes = await fs_1.promises.readFile(inputPath);
                    if (media.mimetype === 'image/png') {
                        image = await pdfDoc.embedPng(imgBytes);
                    }
                    else {
                        image = await pdfDoc.embedJpg(imgBytes);
                    }
                    const page = pdfDoc.addPage([595.28, 841.89]);
                    const scaleX = 595.28 / image.width;
                    const scaleY = 841.89 / image.height;
                    const scale = Math.min(scaleX, scaleY);
                    const imgWidth = image.width * scale;
                    const imgHeight = image.height * scale;
                    const x = (595.28 - imgWidth) / 2;
                    const y = (841.89 - imgHeight) / 2;
                    page.drawImage(image, {
                        x: x,
                        y: y,
                        width: imgWidth,
                        height: imgHeight
                    });
                    const pdfBytes = await pdfDoc.save();
                    const outputPath = path_1.default.join(dirPath, 'output.pdf');
                    await fs_1.promises.writeFile(outputPath, pdfBytes);
                    const pdfMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                    await message.reply(pdfMessage);
                }
                catch (error) {
                    console.error('Error during PDF creation:', error);
                    await message.reply('Ocurrió un error inesperado al convertir la imagen a PDF. Por favor, intente nuevamente.');
                }
                finally {
                    cleanupCallback();
                    resolve();
                }
            });
        });
    }
}
exports.default = ImgToPdfCommand;
//# sourceMappingURL=ImgToPdfCommand.js.map