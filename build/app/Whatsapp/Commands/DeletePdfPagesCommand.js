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
class DeletePdfPagesCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!delete <rangos> (Responda a un PDF) - Elimina las páginas especificadas.';
    }
    async handle(message, _client, _session) {
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (cmd !== '!delete')
            return;
        if (!message.hasQuotedMsg) {
            await message.reply('Por favor, cite un archivo PDF.');
            return;
        }
        const media = await (0, QuotedMessage_1.downloadQuotedMediaSafely)(message, 'DeletePdfPagesCommand');
        if (!media || media.mimetype !== 'application/pdf') {
            await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.');
            return;
        }
        const inlineText = body.replace(cmd, '').trim();
        if (!inlineText) {
            await message.reply('Por favor, especifique un rango de páginas válido. Ejemplo: !delete 1,3-5');
            return;
        }
        await message.reply('Iniciando la eliminación de páginas... esto puede tardar un momento...');
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
                    const originalTotalPages = pdfDoc.getPageCount();
                    const pagesToDelete = new Set();
                    const ranges = inlineText.split(',');
                    for (const range of ranges) {
                        const [startStr, endStr] = range.split('-');
                        const start = parseInt(startStr, 10);
                        const end = endStr ? parseInt(endStr, 10) : start;
                        if (!isNaN(start) && !isNaN(end)) {
                            for (let i = start; i <= end; i++) {
                                pagesToDelete.add(i - 1);
                            }
                        }
                    }
                    const pagesToDeleteDesc = Array.from(pagesToDelete).sort((a, b) => b - a);
                    let deletedPagesCount = 0;
                    for (const pageNum of pagesToDeleteDesc) {
                        if (pageNum >= 0 && pageNum < originalTotalPages) {
                            pdfDoc.removePage(pageNum);
                            deletedPagesCount++;
                        }
                    }
                    if (deletedPagesCount === 0) {
                        await message.reply('No se eliminó ninguna página. Asegúrese de que los rangos indicados existan en el documento.');
                        return resolve();
                    }
                    const newTotalPages = pdfDoc.getPageCount();
                    const newPdfBytes = await pdfDoc.save();
                    const outputPath = path_1.default.join(dirPath, 'output.pdf');
                    await fs_1.promises.writeFile(outputPath, newPdfBytes);
                    const newPdfMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                    await message.reply(newPdfMessage);
                    await message.reply(`Se han eliminado ${deletedPagesCount} páginas. El documento ahora tiene ${newTotalPages} páginas (originalmente ${originalTotalPages} páginas).`);
                }
                catch (error) {
                    console.error('Exception encountered while executing operation', error);
                    await message.reply('Ocurrió un error al eliminar las páginas del archivo PDF. Por favor, intente nuevamente.');
                }
                finally {
                    cleanupCallback();
                    resolve();
                }
            });
        });
    }
}
exports.default = DeletePdfPagesCommand;
//# sourceMappingURL=DeletePdfPagesCommand.js.map