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
class SplitMergePdfCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!split-merge <1-2,4> (Responda a un PDF) - Extrae y combina las páginas especificadas.';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!split-merge')
            return;
        if (!message.hasQuotedMsg) {
            await message.reply('Por favor, cite un archivo PDF.');
            return;
        }
        const media = await (0, QuotedMessage_1.downloadQuotedMediaSafely)(message, 'SplitMergePdfCommand');
        if (!media || media.mimetype !== 'application/pdf') {
            await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.');
            return;
        }
        const inlineText = body.replace(cmd, '').trim();
        if (!inlineText) {
            await message.reply('Por favor, especifique un rango de páginas válido. Ejemplo: !split-merge 1,3-5');
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
                    const splitPdf = async (pdfDoc, rangesToExtract) => {
                        const splitParts = [];
                        for (const range of rangesToExtract) {
                            const splitPartDoc = await pdf_lib_1.PDFDocument.create();
                            const validRange = range.filter(i => i >= 0 && i < pdfDoc.getPageCount());
                            if (validRange.length === 0)
                                continue;
                            const pages = await splitPartDoc.copyPages(pdfDoc, validRange);
                            pages.forEach(page => splitPartDoc.addPage(page));
                            splitParts.push(splitPartDoc);
                        }
                        return splitParts;
                    };
                    const combinePdfs = async (pdfDocs) => {
                        const combinedDoc = await pdf_lib_1.PDFDocument.create();
                        for (const pdfDoc of pdfDocs) {
                            const pages = await combinedDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
                            pages.forEach(page => combinedDoc.addPage(page));
                        }
                        return combinedDoc;
                    };
                    const ranges = inlineText.split(',').map(range => {
                        const [startStr, endStr] = range.split('-');
                        const start = Number(startStr);
                        const end = endStr ? Number(endStr) : undefined;
                        if (end) {
                            return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
                        }
                        else {
                            return [start - 1];
                        }
                    });
                    const originalPdfDoc = await pdf_lib_1.PDFDocument.load(await fs_1.promises.readFile(inputPath));
                    const splitDocs = await splitPdf(originalPdfDoc, ranges);
                    if (splitDocs.length === 0) {
                        await message.reply('El rango especificado no coincide con las páginas del documento original.');
                        return resolve();
                    }
                    const combinedDoc = await combinePdfs(splitDocs);
                    const combinedPdfBytes = await combinedDoc.save();
                    const outputPath = path_1.default.join(dirPath, 'output.pdf');
                    await fs_1.promises.writeFile(outputPath, combinedPdfBytes);
                    const combinedPdfMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                    await message.reply(combinedPdfMessage);
                }
                catch (error) {
                    console.error('Exception encountered while executing operation', error);
                    await message.reply('Ocurrió un error al dividir y combinar el archivo PDF. Por favor, intente nuevamente.');
                }
                finally {
                    cleanupCallback();
                    resolve();
                }
            });
        });
    }
}
exports.default = SplitMergePdfCommand;
//# sourceMappingURL=SplitMergePdfCommand.js.map