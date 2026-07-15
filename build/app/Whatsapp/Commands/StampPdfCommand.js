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
class StampPdfCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!stamp-pdf <número> (Responda a un PDF) - Sella el documento secuencialmente iniciando con el número especificado.';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!stamp-pdf')
            return;
        if (!message.hasQuotedMsg) {
            await message.reply('Por favor, cite un archivo PDF e indique un número de página inicial.');
            return;
        }
        const args = body.replace(cmd, '').trim();
        const startingNumber = parseInt(args, 10);
        if (isNaN(startingNumber)) {
            await message.reply('Por favor, proporcione un número de página inicial válido.');
            return;
        }
        const media = await (0, QuotedMessage_1.downloadQuotedMediaSafely)(message, 'StampPdfCommand');
        if (!media || media.mimetype !== 'application/pdf') {
            await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.');
            return;
        }
        await new Promise((resolve) => {
            tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                if (err) {
                    await message.reply('Ocurrió un error al preparar el entorno de procesamiento.');
                    return resolve();
                }
                try {
                    const inputPath = path_1.default.join(dirPath, 'input.pdf');
                    await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                    const pdfBytes = await fs_1.promises.readFile(inputPath);
                    const pdfDoc = await pdf_lib_1.PDFDocument.load(pdfBytes);
                    const pages = pdfDoc.getPages();
                    const font = await pdfDoc.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
                    let pageNumber = startingNumber;
                    for (const page of pages) {
                        const rotation = page.getRotation().angle % 360;
                        const { width, height } = page.getSize();
                        const text = `${pageNumber}`;
                        const fontSize = 12;
                        const textWidth = font.widthOfTextAtSize(text, fontSize);
                        const textHeight = font.heightAtSize(fontSize);
                        const margin = 10;
                        let x, y, rotationAngle;
                        switch (rotation) {
                            case 0:
                            case 360:
                                x = width - textWidth - margin;
                                y = margin;
                                rotationAngle = (0, pdf_lib_1.degrees)(0);
                                break;
                            case 90:
                                x = width - textHeight - margin;
                                y = height - textWidth - margin;
                                rotationAngle = (0, pdf_lib_1.degrees)(90);
                                break;
                            case 180:
                                x = textWidth + margin;
                                y = height - textHeight - margin;
                                rotationAngle = (0, pdf_lib_1.degrees)(180);
                                break;
                            case 270:
                                x = margin;
                                y = height - textWidth - margin;
                                rotationAngle = (0, pdf_lib_1.degrees)(270);
                                break;
                            default:
                                x = width - textWidth - margin;
                                y = margin;
                                rotationAngle = (0, pdf_lib_1.degrees)(0);
                                break;
                        }
                        page.drawText(text, {
                            x: x,
                            y: y,
                            size: fontSize,
                            font: font,
                            color: (0, pdf_lib_1.rgb)(0, 0, 0),
                            rotate: rotationAngle,
                        });
                        pageNumber++;
                    }
                    const modifiedPdfBytes = await pdfDoc.save();
                    const outputPath = path_1.default.join(dirPath, 'output.pdf');
                    await fs_1.promises.writeFile(outputPath, modifiedPdfBytes);
                    const modifiedPdfMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                    await message.reply(modifiedPdfMessage);
                }
                catch (error) {
                    console.error('Exception encountered while processing the PDF', error);
                    await message.reply('Ocurrió un error al sellar el archivo PDF. Por favor, intente nuevamente.');
                }
                finally {
                    cleanupCallback();
                    resolve();
                }
            });
        });
    }
}
exports.default = StampPdfCommand;
//# sourceMappingURL=StampPdfCommand.js.map