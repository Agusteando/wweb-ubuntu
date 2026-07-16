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
exports.getBase64FromEndpoint = exports.sendEmail = exports.createAudioPrediction2 = exports.convertWordToPdf = exports.convertPdfToWord = exports.getGoogleAdminAuth = void 0;
const googleapis_1 = require("googleapis");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const Application_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Application"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const PDFServicesSdk = __importStar(require("@adobe/pdfservices-node-sdk"));
const tmp_1 = __importDefault(require("tmp"));
const QuotedMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/QuotedMessage");
async function getGoogleAdminAuth(scopes, subjectEmail) {
    const credPath = Env_1.default.get('GOOGLE_CREDENTIALS_PATH');
    if (!credPath) {
        throw new Error('CRITICAL: Missing environment variable GOOGLE_CREDENTIALS_PATH. Must be set to use Google API features.');
    }
    const absolutePath = path_1.default.isAbsolute(credPath)
        ? credPath
        : path_1.default.resolve(Application_1.default.appRoot, credPath);
    let content;
    try {
        content = await fs_1.promises.readFile(absolutePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Google credentials file not found at: ${absolutePath}. Please ensure the file exists and is accessible.`);
        }
        throw error;
    }
    const auth = JSON.parse(content);
    const client = new googleapis_1.google.auth.JWT({
        email: auth.client_email,
        key: auth.private_key,
        scopes: scopes,
        subject: subjectEmail || Env_1.default.get('G_SUITE_ADMIN_EMAIL', 'desarrollo.tecnologico@casitaiedis.edu.mx')
    });
    await client.authorize();
    return client;
}
exports.getGoogleAdminAuth = getGoogleAdminAuth;
function getAdobeContext() {
    const clientId = Env_1.default.get('ADOBE_CLIENT_ID');
    const clientSecret = Env_1.default.get('ADOBE_CLIENT_SECRET');
    if (!clientId || !clientSecret)
        return null;
    const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
        .withClientId(clientId)
        .withClientSecret(clientSecret)
        .build();
    return PDFServicesSdk.ExecutionContext.create(credentials);
}
async function convertPdfToWord(media, _message) {
    const context = getAdobeContext();
    if (!context) {
        console.log('Skipping PDF to Word convert: Adobe credentials missing.');
        return false;
    }
    return new Promise((resolve) => {
        tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
            if (err)
                return resolve(false);
            try {
                const inputPath = path_1.default.join(dirPath, 'input.pdf');
                const outputPath = path_1.default.join(dirPath, `${Date.now()}.docx`);
                await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                const exportPdfOperation = PDFServicesSdk.ExportPDF.Operation.createNew(PDFServicesSdk.ExportPDF.SupportedTargetFormats.DOCX);
                const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath);
                exportPdfOperation.setInput(input);
                const result = await exportPdfOperation.execute(context);
                await result.saveAsFile(outputPath);
                const { MessageMedia } = await Promise.resolve().then(() => __importStar(require('whatsapp-web.js')));
                const wordMedia = await MessageMedia.fromFilePath(outputPath);
                resolve(wordMedia);
            }
            catch (e) {
                console.error('Exception encountered while converting PDF to Word:', e);
                resolve(false);
            }
            finally {
                cleanupCallback();
            }
        });
    });
}
exports.convertPdfToWord = convertPdfToWord;
async function convertWordToPdf(media, _message) {
    const context = getAdobeContext();
    if (!context) {
        console.log('Skipping Word to PDF convert: Adobe credentials missing.');
        return false;
    }
    return new Promise((resolve) => {
        tmp_1.default.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
            if (err)
                return resolve(false);
            try {
                const inputPath = path_1.default.join(dirPath, 'input.docx');
                const outputPath = path_1.default.join(dirPath, `${Date.now()}.pdf`);
                await fs_1.promises.writeFile(inputPath, media.data, 'base64');
                const createPdfOperation = PDFServicesSdk.CreatePDF.Operation.createNew();
                const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath, PDFServicesSdk.CreatePDF.SupportedSourceFormat.docx);
                createPdfOperation.setInput(input);
                const result = await createPdfOperation.execute(context);
                await result.saveAsFile(outputPath);
                const { MessageMedia } = await Promise.resolve().then(() => __importStar(require('whatsapp-web.js')));
                const pdfMedia = await MessageMedia.fromFilePath(outputPath);
                resolve(pdfMedia);
            }
            catch (e) {
                console.error('Exception encountered while converting Word to PDF:', e);
                resolve(false);
            }
            finally {
                cleanupCallback();
            }
        });
    });
}
exports.convertWordToPdf = convertWordToPdf;
async function createAudioPrediction2(message) {
    const media = await (0, QuotedMessage_1.downloadMessageMediaSafely)(message, 'AudioTranscriptionAutomation');
    if (!media || !media.data)
        return null;
    return new Promise((resolve, reject) => {
        tmp_1.default.file({ postfix: '.ogg' }, async (err, tempPath) => {
            if (err)
                return reject(err);
            try {
                await fs_1.promises.writeFile(tempPath, media.data, 'base64');
                const token = Env_1.default.get('OPENAI_API_KEY');
                if (!token)
                    throw new Error('OPENAI_API_KEY is not configured in .env');
                const form = new form_data_1.default();
                const readStream = require('fs').createReadStream(tempPath);
                form.append('file', readStream);
                form.append('model', 'whisper-1');
                form.append('prompt', '¡Hola!\n\n¿Cómo estás?\n\nBienvenido a mi bitácora:\nQuisiera comenzar con...');
                console.log("Now reaching out to OPENAI's Whisper...");
                const response = await axios_1.default.post('https://api.openai.com/v1/audio/transcriptions', form, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        ...form.getHeaders(),
                    },
                    timeout: 30000
                });
                console.log("Whisper has answered.");
                const transcription = response.data.text;
                console.log('Whisper output:', transcription);
                let detectedLanguage = 'unknown';
                try {
                    detectedLanguage = 'es';
                }
                catch (e) { }
                resolve({ transcription, audioFilePath: tempPath, detectedLanguage });
            }
            catch (error) {
                try {
                    await fs_1.promises.unlink(tempPath);
                }
                catch (e) { }
                reject(error);
            }
        });
    });
}
exports.createAudioPrediction2 = createAudioPrediction2;
async function sendEmail(data) {
    data = Object.assign({}, {
        to: data.to || 'aguswubslyn@gmail.com',
        from: data.from || 'desarrollo.tecnologico@casitaiedis.edu.mx',
        alias: data.alias || 'Agustín Jurado',
        data: data.data || {},
        html: data.message || '',
        subject: data.subject || 'Información solicitada',
        files: data.files || undefined,
        template: data.template || undefined
    }, data);
    try {
        console.log('Preparing to dispatch email to:', data.to);
        const jwtClient = await getGoogleAdminAuth(['https://mail.google.com/'], data.from);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth: jwtClient });
        const MailComposer = require('nodemailer/lib/mail-composer');
        const attachments = (data.files || []).map((file) => {
            let extension = 'bin';
            if (file.mimetype) {
                const parts = file.mimetype.split('/');
                if (parts.length > 1) {
                    extension = parts[1].split(';')[0];
                }
            }
            return {
                filename: file.filename || `adjunto.${extension}`,
                content: file.data,
                encoding: 'base64',
                contentType: file.mimetype
            };
        });
        const mailOptions = {
            from: `"${data.alias}" <${data.from}>`,
            to: data.to,
            subject: data.subject,
            html: data.html,
            attachments: attachments
        };
        const mailComposer = new MailComposer(mailOptions);
        const messageBuffer = await mailComposer.compile().build();
        const encodedMessage = messageBuffer.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });
        console.log('Email dispatched successfully via Gmail API');
        return { status: 200, data: res.data };
    }
    catch (err) {
        console.error('Error sending email:', err);
        return { status: 500, error: err.message };
    }
}
exports.sendEmail = sendEmail;
async function getBase64FromEndpoint(endpoint) {
    const response = await axios_1.default.get(endpoint, { responseType: 'arraybuffer' });
    const b64data = Buffer.from(response.data, 'binary').toString('base64');
    return [{ mimetype: response.headers['content-type'] || 'image/png', data: b64data }];
}
exports.getBase64FromEndpoint = getBase64FromEndpoint;
//# sourceMappingURL=Utils.js.map