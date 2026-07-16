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
const SentMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/SentMessage");
const ChatId_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/ChatId");
class SplitPdfCommand {
    constructor() {
        this.type = "Command";
        this.instructions = "!split <1,3-5> (Responda a un PDF) - Divide el PDF en los rangos especificados.";
    }
    async handle(message, client, _session) {
        const body = message.body || "";
        const cmd = body.split(" ")[0].toLowerCase();
        if (cmd !== "!split")
            return;
        const clientId = Env_1.default.get("ADOBE_CLIENT_ID");
        const clientSecret = Env_1.default.get("ADOBE_CLIENT_SECRET");
        if (!clientId || !clientSecret) {
            await message.reply("Error del sistema: Las credenciales de Adobe PDF no están configuradas.");
            return;
        }
        if (!message.hasQuotedMsg) {
            await message.reply("Por favor, cite un archivo PDF.");
            return;
        }
        const media = await (0, QuotedMessage_1.downloadQuotedMediaSafely)(message, "SplitPdfCommand");
        if (!media) {
            await message.reply("El archivo citado ya no está disponible para descarga. Reenvíe el PDF y vuelva a ejecutar el comando.");
            return;
        }
        if (media.mimetype !== "application/pdf") {
            await message.reply("Formato de archivo no soportado. Por favor, cite un archivo PDF.");
            return;
        }
        const pdfMedia = media;
        const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
            .withClientId(clientId)
            .withClientSecret(clientSecret)
            .build();
        const executionContext = PDFServicesSdk.ExecutionContext.create(credentials);
        await new Promise((resolve) => {
            tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
                if (err) {
                    await message.reply("Ocurrió un error al preparar el entorno de procesamiento.");
                    return resolve();
                }
                try {
                    const inputPath = path_1.default.join(dirPath, "input.pdf");
                    await fs_1.promises.writeFile(inputPath, pdfMedia.data, "base64");
                    const splitOperation = PDFServicesSdk.SplitPDF.Operation.createNew();
                    const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath);
                    splitOperation.setInput(input);
                    const pageRanges = new PDFServicesSdk.PageRanges();
                    const inlineText = body.replace(cmd, "").trim();
                    const ranges = inlineText.split(",");
                    if (ranges.length === 0 || !ranges[0]) {
                        await message.reply("Por favor, especifique un rango de páginas válido. Ejemplo: !split 1,3-5");
                        return resolve();
                    }
                    ranges.forEach((range) => {
                        const [start, end] = range.split("-");
                        if (end) {
                            pageRanges.addPageRange(parseInt(start, 10), parseInt(end, 10));
                        }
                        else {
                            pageRanges.addSinglePage(parseInt(start, 10));
                        }
                    });
                    splitOperation.setPageRanges(pageRanges);
                    const result = await splitOperation.execute(executionContext);
                    let filesPromises = [];
                    for (let i = 0; i < result.length; i++) {
                        const outputPath = path_1.default.join(dirPath, `split_${i}.pdf`);
                        filesPromises.push(result[i].saveAsFile(outputPath).then(() => outputPath));
                    }
                    const outputPaths = await Promise.all(filesPromises);
                    const sourceDestination = message.fromMe
                        ? message.to
                        : message.from;
                    const destination = await (0, ChatId_1.resolveMessageDestination)(message, client);
                    console.info(`[SplitPdfCommand] PDF processing completed. Sending ${outputPaths.length} output file(s) to ${destination}${sourceDestination && sourceDestination !== destination
                        ? ` (resolved from ${sourceDestination})`
                        : ""}.`);
                    for (let index = 0; index < outputPaths.length; index += 1) {
                        const outputPath = outputPaths[index];
                        const filename = `split_${index + 1}_of_${outputPaths.length}.pdf`;
                        const splitPdfMessage = await whatsapp_web_js_1.MessageMedia.fromFilePath(outputPath);
                        splitPdfMessage.filename = filename;
                        const sentMessage = await client.sendMessage(destination, splitPdfMessage, {
                            sendMediaAsDocument: true,
                            waitUntilMsgSent: true,
                            sendSeen: false,
                        });
                        const metadata = (0, SentMessage_1.requireSentMessageMetadata)(sentMessage, destination);
                        console.info(`[SplitPdfCommand] Delivered ${filename} to ${destination} as ${metadata.id}.`);
                    }
                }
                catch (error) {
                    console.error("Exception encountered while executing operation", error);
                    await message.reply("Ocurrió un error al dividir el archivo PDF. Por favor, intente nuevamente.");
                }
                finally {
                    cleanupCallback();
                    resolve();
                }
            });
        });
    }
}
exports.default = SplitPdfCommand;
//# sourceMappingURL=SplitPdfCommand.js.map